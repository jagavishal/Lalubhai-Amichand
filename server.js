'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

// Node 15+ terminates the whole process on an unhandled rejection by default. Every
// request handler in this app already has its own try/catch, so the only way to hit
// one of these is a stray fire-and-forget async call (e.g. a background email) — that
// must never be allowed to kill the server and force PM2 to restart (and cold-start
// ensureSchema()) for every user, repeatedly. Log and keep running instead.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.stack || err);
});

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const nodemailer = require('nodemailer');
const { Readable } = require('stream');

let _mailer = null;
function getMailer() {
  if (_mailer) return _mailer;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  _mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return _mailer;
}

async function sendDelegationEmail({ toEmail, toName, description, dueDate, priority, delegatedByName, url, remarks }) {
  const mailer = getMailer();
  console.log('[email] sendDelegationEmail → toEmail:', toEmail, '| mailer ready:', !!mailer, '| SMTP_USER:', process.env.SMTP_USER || '(not set)');
  if (!mailer || !toEmail) return;
  try {
    await mailer.sendMail({
      from: `"Task Manager" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: `New Task Assigned: ${description.slice(0, 60)}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;padding:24px;border:1px solid #e2e8f0;border-radius:8px">
          <h2 style="color:#6366f1;margin:0 0 16px">New Task Assigned to You</h2>
          <p style="color:#374151">Hi <b>${toName}</b>,</p>
          <p style="color:#374151">A new task has been delegated to you by <b>${delegatedByName || 'Admin'}</b>.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;background:#f8fafc;font-weight:600;color:#374151;width:130px">Description</td><td style="padding:8px;color:#374151">${description}</td></tr>
            <tr><td style="padding:8px;background:#f8fafc;font-weight:600;color:#374151">Due Date</td><td style="padding:8px;color:#374151">${dueDate || '—'}</td></tr>
            <tr><td style="padding:8px;background:#f8fafc;font-weight:600;color:#374151">Priority</td><td style="padding:8px;color:#374151">${priority || 'Low'}</td></tr>
            ${url ? `<tr><td style="padding:8px;background:#f8fafc;font-weight:600;color:#374151">URL</td><td style="padding:8px"><a href="${url}" style="color:#6366f1">${url}</a></td></tr>` : ''}
            ${remarks ? `<tr><td style="padding:8px;background:#f8fafc;font-weight:600;color:#374151">Remarks</td><td style="padding:8px;color:#374151">${remarks}</td></tr>` : ''}
          </table>
          <p style="color:#94a3b8;font-size:12px;margin-top:24px">This is an automated notification from Task Manager.</p>
        </div>
      `,
    });
    console.log('[email] Delegation email sent to:', toEmail);
  } catch (e) {
    console.error('[email] Failed to send delegation email:', e.message);
  }
}

const DEFAULT_PASSWORD = 'India@123';
const FMS_ENABLED = true;

const g = global;
if (!g.__store_version) g.__store_version = 0;
function getStoreVersion() { return g.__store_version; }
function bumpStoreVersion() { g.__store_version++; }
const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/i;

// ── PostgreSQL→MySQL query translator (used when DB_TYPE=mysql) ───────────────
function pgToMysql(text) {
  let t = text;
  // Remove pg type casts: ::timestamptz ::int ::text ::date etc.
  t = t.replace(/::[a-z]+(?:\[\])?/gi, '');
  // Reserved-word columns "key"/"value" → backticks
  t = t.replace(/"key"/g, '`key`').replace(/"value"/g, '`value`');
  // EXCLUDED.col → VALUES(col)
  t = t.replace(/EXCLUDED\.(\w+)/g, 'VALUES($1)');
  // ON CONFLICT (...) DO NOTHING → INSERT IGNORE
  if (/ON CONFLICT\s*\([^)]+\)\s*DO NOTHING/i.test(t)) {
    t = t.replace(/\bINSERT INTO\b/i, 'INSERT IGNORE INTO');
    t = t.replace(/\s*ON CONFLICT\s*\([^)]+\)\s*DO NOTHING/gi, '');
  }
  // ON CONFLICT (...) DO UPDATE SET → ON DUPLICATE KEY UPDATE
  t = t.replace(/ON CONFLICT\s*\([^)]+\)\s*DO UPDATE SET\s*/gi, 'ON DUPLICATE KEY UPDATE ');
  // table.column → bare column, but ONLY inside ON DUPLICATE KEY UPDATE — MySQL upsert can't
  // reference other tables there (e.g. "password_hash=COALESCE(VALUES(password_hash),users.password_hash)"
  // needs "users." stripped). This used to run on the WHOLE query, which also stripped real
  // JOIN qualifiers like "m.id = cc.master_id" down to "id = master_id" — MySQL then rejects
  // that as an ambiguous column whenever the joined tables share a column name (e.g. every
  // table's own "id"), which is what broke /api/checklist-completions.
  const dupIdx = t.search(/ON DUPLICATE KEY UPDATE/i);
  if (dupIdx !== -1) {
    t = t.slice(0, dupIdx) + t.slice(dupIdx).replace(/\b[a-z_]+\.([a-z_]+)\b/g, '$1');
  }
  // $N → ?
  t = t.replace(/\$\d+/g, '?');
  return t;
}

// ── Unified DB pool (MySQL or PostgreSQL) ─────────────────────────────────────
if (!g.__db_pool) {
  const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  const dbType = process.env.DB_TYPE
    || (dbUrl ? (dbUrl.startsWith('mysql') ? 'mysql' : 'postgres') : null)
    || (process.env.DB_HOST ? 'mysql' : null);

  if (dbType === 'mysql') {
    const mysql2 = require('mysql2/promise');
    // connectTimeout fails a dead/unreachable DB fast instead of hanging past the
    // client's own timeout; queueLimit means an exhausted pool errors immediately
    // rather than queuing requests forever if a connection is ever stuck.
    const poolOpts = dbUrl
      ? { uri: dbUrl, waitForConnections: true, connectionLimit: 10, queueLimit: 30, connectTimeout: 10000 }
      : { host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, waitForConnections: true, connectionLimit: 10, queueLimit: 30, connectTimeout: 10000 };
    const myPool = mysql2.createPool(poolOpts);
    // Normalize collation on every new connection
    myPool.pool.on('connection', conn => {
      conn.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'", () => {});
    });
    g.__db_pool = {
      async query(text, params) {
        if (WRITE_RE.test(text)) bumpStoreVersion();
        const [rows] = await myPool.execute(pgToMysql(text), params || []);
        return { rows: Array.isArray(rows) ? rows : [], rowCount: rows.affectedRows || 0 };
      },
      async connect() {
        const conn = await myPool.getConnection();
        return {
          async query(text, params) {
            if (WRITE_RE.test(text)) bumpStoreVersion();
            const [rows] = await conn.execute(pgToMysql(text), params || []);
            return { rows: Array.isArray(rows) ? rows : [], rowCount: rows.affectedRows || 0 };
          },
          release() { conn.release(); },
        };
      },
      end() { return myPool.end(); },
    };
  } else if (dbType === 'postgres') {
    const pg = require('pg');
    const pgUrl = dbUrl || (process.env.DB_HOST
      ? `postgresql://${encodeURIComponent(process.env.DB_USER||'')}:${encodeURIComponent(process.env.DB_PASSWORD||'')}@${process.env.DB_HOST}:${process.env.DB_PORT||5432}/${process.env.DB_NAME||'postgres'}`
      : null);
    if (pgUrl) {
      const useSsl = !/railway\.internal|localhost|127\.0\.0\.1/.test(pgUrl);
      const pgPool = new pg.Pool({ connectionString: pgUrl, ssl: useSsl ? { rejectUnauthorized: false } : false, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
      g.__db_pool = {
        query: (t, p) => { if (WRITE_RE.test(t)) bumpStoreVersion(); return pgPool.query(t, p); },
        connect: (...a) => pgPool.connect(...a),
        end: () => pgPool.end(),
      };
    } else { g.__db_pool = null; }
  } else { g.__db_pool = null; }
  g.__pg_schema_ready = null;
}
const pool = g.__db_pool || {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => { throw new Error('Database not configured'); },
  end: async () => {},
};

async function q(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

// Tagged-template sql helper
async function sql(strings, ...values) {
  let text = '';
  const params = [];
  strings.forEach((str, i) => {
    text += str;
    if (i < values.length) {
      const v = values[i];
      params.push(Array.isArray(v) ? v.join(',') : (v ?? null));
      text += '$' + params.length;
    }
  });
  const { rows } = await pool.query(text, params);
  return rows;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id VARCHAR(16) PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL, phone VARCHAR(64) DEFAULT '', department VARCHAR(128) DEFAULT '', branch VARCHAR(64) DEFAULT '', roles VARCHAR(128) DEFAULT 'User', active SMALLINT NOT NULL DEFAULT 1, password_hash VARCHAR(255) DEFAULT NULL, picture TEXT DEFAULT NULL, force_logout_after DATETIME DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(name, email)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_users_name ON users (name)`,
  `CREATE INDEX idx_users_email ON users (email)`,
  `CREATE INDEX idx_users_department ON users (department)`,
  `CREATE TABLE IF NOT EXISTS delegations (id VARCHAR(16) PRIMARY KEY, description TEXT NOT NULL, doer_id VARCHAR(16), doer VARCHAR(255) NOT NULL DEFAULT '', delegated_by VARCHAR(16), due_date DATE, client VARCHAR(255) DEFAULT '', status VARCHAR(32) NOT NULL DEFAULT 'pending', type VARCHAR(32) NOT NULL DEFAULT 'delegation', priority VARCHAR(32) DEFAULT 'Low', approval VARCHAR(64) DEFAULT 'No Approval', url VARCHAR(500) DEFAULT '', remarks TEXT, completed_at DATETIME DEFAULT NULL, revise_action VARCHAR(32) DEFAULT NULL, transferred_by VARCHAR(255) DEFAULT NULL, transferred_from VARCHAR(255) DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_del_doer ON delegations (doer)`,
  `CREATE INDEX idx_del_status ON delegations (status)`,
  `CREATE INDEX idx_del_doer_id ON delegations (doer_id)`,
  `CREATE INDEX idx_del_delegated_by ON delegations (delegated_by)`,
  `CREATE TABLE IF NOT EXISTS masters (id VARCHAR(16) PRIMARY KEY, task TEXT NOT NULL, assigned_to VARCHAR(255) DEFAULT '', frequency VARCHAR(32) NOT NULL DEFAULT 'Daily', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_masters_assigned_to ON masters (assigned_to)`,
  `ALTER TABLE masters ADD COLUMN IF NOT EXISTS start_date DATE DEFAULT NULL`,
  `ALTER TABLE masters ADD COLUMN IF NOT EXISTS end_date DATE DEFAULT NULL`,
  `ALTER TABLE masters ADD COLUMN IF NOT EXISTS remarks TEXT DEFAULT NULL`,
  `ALTER TABLE masters ADD COLUMN IF NOT EXISTS department VARCHAR(128) DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS holidays (id VARCHAR(16) PRIMARY KEY, date DATE NOT NULL, name VARCHAR(255) NOT NULL, type VARCHAR(64) DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // The old FMS feature was a hardcoded 8-step client-campaign tracker with no
  // reachable nav entry — replaced below by the Google-Sheets-backed FMS module.
  `DROP TABLE IF EXISTS fms_steps`,
  `DROP TABLE IF EXISTS fms`,
  // ── FMS (Flow Management System) — config-only tables. Row data itself always
  // lives in the live external Google Sheet; these tables only store which sheet,
  // which columns mean what, and who the doers are.
  `CREATE TABLE IF NOT EXISTS fms_sheets (id VARCHAR(24) PRIMARY KEY, fms_name VARCHAR(255) NOT NULL, sheet_name VARCHAR(255) NOT NULL, sheet_id VARCHAR(255) NOT NULL, header_row INT NOT NULL DEFAULT 1, created_by VARCHAR(16) DEFAULT NULL, process_coordinator_id VARCHAR(16) DEFAULT NULL, intake_sheet_id VARCHAR(255) DEFAULT '', intake_sheet_name VARCHAR(255) DEFAULT '', intake_header_row INT DEFAULT NULL, intake_form_name VARCHAR(255) DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // Per-flow mute for the next-step email (see sendFmsNextStepEmail). Defaults to
  // 1 so the single global 'fms_notify_enabled' switch is all an admin has to flip
  // to start mail on every existing flow; this column only exists to silence one.
  `ALTER TABLE fms_sheets ADD COLUMN IF NOT EXISTS notify_enabled SMALLINT NOT NULL DEFAULT 1`,
  `CREATE TABLE IF NOT EXISTS fms_sheet_steps (id VARCHAR(24) PRIMARY KEY, fms_id VARCHAR(24) NOT NULL, step_order INT NOT NULL DEFAULT 0, step_name VARCHAR(255) NOT NULL, plan_col VARCHAR(8) NOT NULL, actual_col VARCHAR(8) NOT NULL, extra_input VARCHAR(4) NOT NULL DEFAULT 'no', extra_col VARCHAR(8) DEFAULT '', show_cols TEXT DEFAULT NULL, delay_reason_col VARCHAR(8) DEFAULT '', doer_name_col VARCHAR(8) DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_fms_steps_fms ON fms_sheet_steps (fms_id)`,
  `CREATE TABLE IF NOT EXISTS fms_step_doers (step_id VARCHAR(24) NOT NULL, user_id VARCHAR(16) NOT NULL, PRIMARY KEY (step_id, user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_fms_doers_user ON fms_step_doers (user_id)`,
  `CREATE TABLE IF NOT EXISTS fms_extra_rows (id VARCHAR(24) PRIMARY KEY, step_id VARCHAR(24) NOT NULL, row_label VARCHAR(255) NOT NULL, col_letter VARCHAR(8) NOT NULL, field_type VARCHAR(16) NOT NULL DEFAULT 'text', dropdown_options TEXT DEFAULT NULL, required SMALLINT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_fms_extra_step ON fms_extra_rows (step_id)`,
  `CREATE TABLE IF NOT EXISTS fms_intake_fields (id VARCHAR(24) PRIMARY KEY, fms_id VARCHAR(24) NOT NULL, field_label VARCHAR(255) NOT NULL, col_letter VARCHAR(8) NOT NULL, field_type VARCHAR(16) NOT NULL DEFAULT 'text', dropdown_options TEXT DEFAULT NULL, required SMALLINT NOT NULL DEFAULT 0, sort_order INT NOT NULL DEFAULT 0, auto_fill VARCHAR(16) DEFAULT '', auto_fill_value VARCHAR(255) DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_fms_intake_fms ON fms_intake_fields (fms_id)`,
  `CREATE TABLE IF NOT EXISTS profile (user_id VARCHAR(16) PRIMARY KEY, notification_email VARCHAR(255) DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  "CREATE TABLE IF NOT EXISTS app_config (`key` VARCHAR(64) PRIMARY KEY, `value` TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  `CREATE TABLE IF NOT EXISTS checklist_completions (id VARCHAR(16) PRIMARY KEY, master_id VARCHAR(16) NOT NULL, doer VARCHAR(255) DEFAULT '', completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, date DATE NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_cc_master ON checklist_completions (master_id)`,
  `CREATE INDEX idx_cc_date ON checklist_completions (date)`,
  `CREATE TABLE IF NOT EXISTS leaves (id VARCHAR(16) PRIMARY KEY, user_id VARCHAR(16), user_name VARCHAR(255) NOT NULL, type VARCHAR(64) DEFAULT 'Leave', from_date DATE NOT NULL, to_date DATE NOT NULL, reason TEXT DEFAULT NULL, status VARCHAR(32) DEFAULT 'pending', approver VARCHAR(255) DEFAULT 'HOD', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_at DATETIME DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS daily_tasks (id VARCHAR(16) PRIMARY KEY, entry_date DATE NOT NULL, doer_id VARCHAR(16), doer VARCHAR(255) NOT NULL DEFAULT '', client VARCHAR(255) DEFAULT '', department VARCHAR(128) DEFAULT '', description TEXT DEFAULT NULL, minutes INT DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_dt_doer ON daily_tasks (doer_id)`,
  `CREATE INDEX idx_dt_date ON daily_tasks (entry_date)`,
  `CREATE TABLE IF NOT EXISTS clients (id VARCHAR(16) PRIMARY KEY, name VARCHAR(255) NOT NULL, contact_person VARCHAR(255) DEFAULT '', contact_number VARCHAR(64) DEFAULT '', email VARCHAR(255) DEFAULT '', industry VARCHAR(128) DEFAULT '', status VARCHAR(32) DEFAULT 'active', notes TEXT DEFAULT NULL, mobile VARCHAR(64) DEFAULT '', state VARCHAR(128) DEFAULT '', district VARCHAR(128) DEFAULT '', address TEXT DEFAULT NULL, pin VARCHAR(16) DEFAULT '', bank_name VARCHAR(255) DEFAULT '', account_holder VARCHAR(255) DEFAULT '', account_no VARCHAR(64) DEFAULT '', ifsc_code VARCHAR(32) DEFAULT '', branch_name VARCHAR(255) DEFAULT '', division VARCHAR(64) DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS dev_backups (id VARCHAR(64) PRIMARY KEY, label VARCHAR(128) NOT NULL DEFAULT '', data TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS user_sessions (sid VARCHAR(128) PRIMARY KEY, data TEXT NOT NULL, expires_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT NULL`,
  // Which of the company's three sites a person belongs to. Free VARCHAR rather
  // than an enum so a fourth site is a one-line frontend change (BRANCHES in
  // public/js/pages/users.js) and never a migration; '' means not yet set, which
  // is what every user carries until an Admin picks one.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS branch VARCHAR(64) DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS payment_entries (id VARCHAR(16) PRIMARY KEY, vendor_id VARCHAR(16) NOT NULL, amount DECIMAL(15,2) NOT NULL DEFAULT 0, txn_type VARCHAR(4) DEFAULT 'N', narration VARCHAR(500) DEFAULT '', status VARCHAR(16) DEFAULT 'draft', created_by VARCHAR(255) DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, exported_at DATETIME DEFAULT NULL, batch_label VARCHAR(128) DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_pe_status ON payment_entries (status)`,
  `CREATE INDEX idx_pe_exported ON payment_entries (exported_at)`,
  `CREATE TABLE IF NOT EXISTS help_tickets (id VARCHAR(16) PRIMARY KEY, subject VARCHAR(255) NOT NULL, description TEXT DEFAULT NULL, priority VARCHAR(16) DEFAULT 'Medium', status VARCHAR(32) DEFAULT 'open', submitted_by VARCHAR(255) NOT NULL DEFAULT '', submitted_by_id VARCHAR(16) DEFAULT NULL, ticket_date DATE DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_ht_status ON help_tickets (status)`,
  `ALTER TABLE help_tickets ADD COLUMN IF NOT EXISTS ticket_date DATE DEFAULT NULL`,
  `ALTER TABLE help_tickets ADD COLUMN IF NOT EXISTS name VARCHAR(255) DEFAULT NULL`,
  `ALTER TABLE help_tickets ADD COLUMN IF NOT EXISTS transferred_to VARCHAR(255) DEFAULT NULL`,
  `CREATE TABLE IF NOT EXISTS announcements (id VARCHAR(16) PRIMARY KEY, title VARCHAR(255) NOT NULL, message TEXT DEFAULT NULL, posted_by VARCHAR(255) NOT NULL DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS vendor_submissions (id VARCHAR(16) PRIMARY KEY, business_name VARCHAR(255) NOT NULL, contact_person VARCHAR(255) DEFAULT '', phone VARCHAR(64) DEFAULT '', email VARCHAR(255) DEFAULT '', gst_no VARCHAR(32) DEFAULT '', address TEXT DEFAULT NULL, products TEXT DEFAULT NULL, notes TEXT DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS pr_requisitions (id VARCHAR(16) PRIMARY KEY, pr_no VARCHAR(64) NOT NULL, filled_by VARCHAR(255) NOT NULL DEFAULT '', vendors TEXT DEFAULT NULL, vendor_other VARCHAR(255) DEFAULT '', department TEXT DEFAULT NULL, department_other VARCHAR(255) DEFAULT '', accessory_product TEXT DEFAULT NULL, brazing_product TEXT DEFAULT NULL, cnc_product VARCHAR(255) DEFAULT '', consumable_product TEXT DEFAULT NULL, electric_product TEXT DEFAULT NULL, packing_product TEXT DEFAULT NULL, pressing_product TEXT DEFAULT NULL, washing_product TEXT DEFAULT NULL, welding_product TEXT DEFAULT NULL, new_product VARCHAR(255) DEFAULT '', current_stock VARCHAR(64) NOT NULL DEFAULT '', quantity_required VARCHAR(64) NOT NULL DEFAULT '', previous_rate VARCHAR(64) NOT NULL DEFAULT '', created_by VARCHAR(255) DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // PR/PO/GRN feature removed — drop its tables (idempotent, no-ops once gone).
  `DROP TABLE IF EXISTS purchase_requisition_items`,
  `DROP TABLE IF EXISTS purchase_order_items`,
  `DROP TABLE IF EXISTS goods_receipt_items`,
  `DROP TABLE IF EXISTS purchase_requisitions`,
  `DROP TABLE IF EXISTS purchase_orders`,
  `DROP TABLE IF EXISTS goods_receipts`,
  `DROP TABLE IF EXISTS packing_items`,
  // ── Inventory Management (IMS): item master + Inward/Outward ledger.
  // current_stock is a maintained running total (moved only by the Inward/
  // Outward routes, never edited directly) rather than a SUM() re-aggregated
  // on every read — cheap reads for the IMS dashboard table.
  `CREATE TABLE IF NOT EXISTS ims_items (item_code VARCHAR(32) PRIMARY KEY, description VARCHAR(255) DEFAULT '', size VARCHAR(64) DEFAULT '', uom VARCHAR(16) DEFAULT '', moq DECIMAL(12,2) DEFAULT 0, max_level DECIMAL(12,2) DEFAULT 0, on_order_qty DECIMAL(12,2) DEFAULT 0, vendor_name VARCHAR(255) DEFAULT '', current_stock DECIMAL(12,2) DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // category separates the two real-world stock books this table now holds —
  // "Stores" (consumables/PPE/welding etc., SKU-coded) and "ALU" (aluminum
  // circle/sheet/coil raw material, ALC-/ALS- coded) — so the IMS page can
  // filter to one book instead of showing both mixed together.
  `ALTER TABLE ims_items ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'Stores'`,
  `CREATE INDEX idx_ims_items_category ON ims_items (category)`,
  `CREATE TABLE IF NOT EXISTS ims_transactions (id VARCHAR(16) PRIMARY KEY, txn_date DATE NOT NULL, direction VARCHAR(3) NOT NULL, item_code VARCHAR(32) NOT NULL, item_name VARCHAR(255) DEFAULT '', quantity DECIMAL(12,2) NOT NULL, uom VARCHAR(16) DEFAULT '', department VARCHAR(64) DEFAULT '', remarks VARCHAR(500) DEFAULT '', status VARCHAR(16) DEFAULT 'Active', created_by VARCHAR(120) DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_ims_txn_item ON ims_transactions (item_code)`,
  `CREATE INDEX idx_ims_txn_date ON ims_transactions (txn_date)`,
  `CREATE INDEX idx_ims_txn_direction ON ims_transactions (direction)`,
  // source distinguishes, within the Trading book, entries typed straight into
  // this app ("In/Out (Manual)") from ones carried over from the Hindalco
  // job-work ledger ("IN/OUT(HINDALCO)") — see IMS_SOURCES. Blank for
  // Stores/ALU, which have never needed more than one ledger per category.
  `ALTER TABLE ims_transactions ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT ''`,
  // size records the dimension the entry actually moved against (Trading's
  // bar/rod/section sizes), captured on the entry itself rather than read back
  // off ims_items.size — the catalog's size can be corrected later, and the
  // ledger must keep showing what was received/issued at the time. Blank for
  // Stores/ALU/Accessories, whose forms don't show the field.
  `ALTER TABLE ims_transactions ADD COLUMN IF NOT EXISTS size VARCHAR(64) NOT NULL DEFAULT ''`,
  // ── Departments master — the ONE list behind every Department dropdown in the
  // app (Users, Daily Task, IMS Inward/Outward, PR Creation, PO Creation). Each
  // of those used to carry its own hardcoded list, so the same shop floor was
  // spelled three different ways depending on the page. Seeded once from
  // FACTORY_DEPARTMENTS; after that it's plain data — any of those dropdowns'
  // "+ Add new department" option appends to it and every other page picks the
  // new name up on its next load. sort_order keeps the seeded list in the
  // factory's own numbering; anything added later sorts after it.
  `CREATE TABLE IF NOT EXISTS departments (id VARCHAR(16) PRIMARY KEY, name VARCHAR(128) NOT NULL, sort_order INT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

// ── HRMS ──────────────────────────────────────────────────────────────────────
// The HR module (employee master, attendance, leave, payroll, HR MIS) lives in
// its own file so the feature reads as one thing rather than another few
// thousand lines here — but its tables are appended to SCHEMA above, so they are
// created and migrated by exactly the same bootstrap as every other table, and
// its routes are handed this file's own pool and guards (see the mount call
// further down, search "mountHrms"). See backend/hrms.js.
const { HR_SCHEMA, mountHrms } = require('./backend/hrms.js');
SCHEMA.push(...HR_SCHEMA);

// The factory's own department list (the numbered list the plant keeps on
// paper), used to seed the `departments` table on a fresh DB and as the
// fallback whenever that table can't be read. Not the live list — once seeded,
// `departments` is the source of truth and this is never consulted again.
const FACTORY_DEPARTMENTS = [
  'Circle Dept.',
  'Pressing Dept.',
  'Rolling Cutting Dept.',
  'CNC Dept.',
  'Tool Room Dept.',
  'New Product Development',
  'Accessories Dept. (Pressing)',
  'Moulding Dept.',
  'Buffing Dept.',
  'Spinning Dept.',
  'Charak Dept.',
  'Fitting Dept.',
  'Welding Dept.',
  'Washing Dept.',
  'Packing Dept.',
  'Office',
  'SS Dept.',
  'General Factory',
  'Consumable Store',
  'Accessories Stores',
  'Fabrication Dept.',
];

// Canonical IMS category list — every value the API will accept/store on an
// item. "Trading" holds the TRD-coded aluminum bar/rod/section catalog
// job-worked with Hindalco (see ims_items_trading_import.sql) — its
// Inward/Outward entries additionally carry a Source (IMS_SOURCES below).
const IMS_CATEGORIES = ['Stores', 'ALU', 'Accessories', 'Trading'];

// The stock books the UI exposes, in sidebar order — each one is a
// self-contained IMS with its own page, route and Inward/Outward/Report tabs,
// so a category is picked by navigating rather than from a dropdown inside the
// forms. Mirrors IMS_BOOKS in public/js/pages/ims.js; `route` must match the
// entries in sidebar.js and the permission keys in users.js.
//
// `label` is display-only: the ALU book reads "IMS Alu & SS" because
// stainless-steel items live in that same book, while its stored category
// value stays 'ALU' (so the ~1257 existing ALU rows needed no migration).
const IMS_CATEGORY_TABS = [
  { key: 'Stores',      route: 'ims-stores',      label: 'IMS Stores' },
  { key: 'ALU',         route: 'ims-alu',         label: 'IMS Alu & SS' },
  { key: 'Accessories', route: 'ims-accessories', label: 'IMS Accessories' },
  { key: 'Trading',     route: 'ims-trading',     label: 'IMS Trading' },
];

// Ledger-source options shown on the Inward/Outward forms only when Category
// is "Trading" — lets a Trading entry be tagged as typed straight in by store
// staff vs. carried over from the Hindalco job-work sheet, matching the two
// source ledgers ("IMS (Trading) - In_Out (Manual)" / "...IN_OUT(HINDALCO)")
// this data has always lived in.
const IMS_SOURCES = ['In/Out (Manual)', 'IN/OUT(HINDALCO)'];

async function seedIfEmpty() {
  const adminEmail = process.env.ADMIN_EMAIL || 'Admin@lal.com';
  const adminName  = process.env.ADMIN_NAME  || 'Admin';
  const adminPass  = process.env.ADMIN_PASSWORD || 'admin';
  const hash = await bcrypt.hash(adminPass, 10);
  try {
    await pool.query(
      'INSERT INTO users (id,name,email,roles,active,password_hash) VALUES ($1,$2,$3,$4,1,$5)',
      ['A001', adminName, adminEmail, 'Admin', hash]
    );
    console.log('[db] Admin user created:', adminEmail);
  } catch (_) {
    try {
      await pool.query(
        'UPDATE users SET password_hash=$1, email=$2, active=1, roles=$3 WHERE id=$4',
        [hash, adminEmail, 'Admin', 'A001']
      );
      console.log('[db] Admin password updated for:', adminEmail);
    } catch (e2) {
      console.error('[db] Failed to ensure admin user:', e2.message);
    }
  }
}

// Fills `departments` from FACTORY_DEPARTMENTS the first time only — an empty
// table means a fresh DB, a non-empty one is the live list (which may well have
// had rows added or removed since) and is left completely alone.
async function seedDepartments() {
  if (!USE_DB) return;
  const rows = await q('SELECT COUNT(*) AS cnt FROM departments');
  if (Number(rows[0]?.cnt || 0) > 0) return;
  for (const [i, name] of FACTORY_DEPARTMENTS.entries()) {
    await pool.query(
      'INSERT INTO departments (id,name,sort_order) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING',
      ['DEP' + String(i + 1).padStart(3, '0'), name, (i + 1) * 10]
    );
  }
  console.log('[db] Seeded', FACTORY_DEPARTMENTS.length, 'departments');
}

// The canonical department list, in display order — every Department dropdown
// in the app is served from here (see GET /api/departments and the masters
// routes for IMS / PR / PO Creation). Never throws: a DB that isn't configured
// or is momentarily unreachable falls back to the seed list rather than leaving
// a form with an empty, unusable dropdown.
async function listDepartments() {
  if (!USE_DB) {
    const store = await readStore();
    const list = Array.isArray(store.departments) ? store.departments.filter(Boolean) : [];
    return list.length ? list : FACTORY_DEPARTMENTS.slice();
  }
  try {
    await ensureSchema();
    const rows = await q('SELECT name FROM departments ORDER BY sort_order ASC, name ASC');
    const list = rows.map(r => r.name).filter(Boolean);
    return list.length ? list : FACTORY_DEPARTMENTS.slice();
  } catch (e) {
    console.error('[departments] read failed, using seed list:', e.message);
    return FACTORY_DEPARTMENTS.slice();
  }
}

// ── Department name casing ────────────────────────────────────────────────────
// Department strings reach the database from four different directions — the
// FACTORY_DEPARTMENTS seed (Title Case), the Users bootstrap script (ALL CAPS),
// the HRMS sheet import (whatever HR typed that day) and every form's "+ Add new
// department" box — so the same shop floor turned up as "Packing Dept." on PR
// Creation and "PACKING DEPT." on the HR employee list, and the HR department
// filter (which builds its options from the values actually stored) showed both
// as if they were two departments. Every write path now runs its department
// through canonicalDept(), and normalizeDepartmentCase() repairs what is already
// stored, so a department is spelled exactly one way across the whole app.

// Words that carry their own capitalisation and must survive title-casing
// intact — without this "CNC Dept." comes back as "Cnc Dept." and "SS Dept." as
// "Ss Dept.". Compared with punctuation stripped, so "CNC." matches too.
const DEPT_ACRONYMS = new Set([
  'CNC', 'SS', 'HR', 'IT', 'QC', 'QA', 'MIS', 'NPD', 'ALU', 'PPC', 'EDP', 'ERP',
  'CXO', 'CEO', 'CFO', 'COO', 'MD', 'SEO', 'R&D', 'PR', 'PO', 'GRN', 'IMS', 'FMS',
]);

// "PACKING DEPT." / "packing dept." → "Packing Dept.". Punctuation and
// separators are left exactly as typed; only the letters move, and each part of
// a hyphenated or slashed word is capitalised ("in/out" → "In/Out").
function titleCaseDept(name) {
  return String(name == null ? '' : name)
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => {
      const bare = word.replace(/[^A-Za-z&]/g, '');
      if (bare && DEPT_ACRONYMS.has(bare.toUpperCase())) return word.toUpperCase();
      return word.toLowerCase().replace(/(^|[^A-Za-z'])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
    })
    .join(' ');
}

// The one spelling of a department the app will store. The departments master
// wins whenever the incoming name matches one of its entries case-insensitively
// — a name typed as "packing dept." into a free-text box is saved as the
// master's own "Packing Dept." — and anything genuinely new is title-cased so
// it joins the list looking like the rest of it.
// `master` is only ever passed by the bulk repair below, which reads the list
// once and reuses it across a few hundred names rather than once per name.
async function canonicalDept(name, master = null) {
  const raw = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const list = master || await listDepartments().catch(() => []);
  const hit = list.find((d) => normDept(d) === normDept(raw));
  return hit || titleCaseDept(raw);
}

// PR Creation stores its Department multi-select as one comma-joined string;
// this canonicalises each name in it and drops case-duplicates ("Packing Dept.,
// PACKING DEPT." was two picks of the same department).
async function canonicalDeptList(value, master = null) {
  const parts = (Array.isArray(value) ? value : String(value == null ? '' : value).split(','))
    .map((v) => String(v).trim())
    .filter(Boolean);
  const list = master || await listDepartments().catch(() => []);
  const out = [];
  for (const p of parts) {
    const c = await canonicalDept(p, list);
    if (c && !out.some((d) => normDept(d) === normDept(c))) out.push(c);
  }
  return out.join(', ');
}

// Every table that stores a department as plain text, repaired at boot against
// the master list. Runs on each cold start rather than once behind a flag: the
// Google Sheet imports (HRMS, users) can put a fresh ALL-CAPS spelling in at any
// time, and a restart then quietly puts it right. Statements are cheap — one
// UPDATE per distinct department per table, almost all of them matching zero
// rows once the data is clean.
const DEPT_TEXT_COLUMNS = [
  ['users', 'department'],
  ['masters', 'department'],
  ['daily_tasks', 'department'],
  ['ims_transactions', 'department'],
  ['hr_employees', 'department'],
  ['hr_payslips', 'department'],
];

async function normalizeDepartmentCase() {
  if (!USE_DB) return;
  let changed = 0;

  // The master list first, so everything below is canonicalised against names
  // that are themselves properly cased. UNIQUE(name) is case-insensitive under
  // utf8mb4_unicode_ci, so re-casing a row can never collide with another.
  try {
    const rows = await q('SELECT id, name FROM departments');
    for (const r of rows) {
      const fixed = titleCaseDept(r.name);
      if (fixed && fixed !== r.name) {
        const res = await pool.query('UPDATE departments SET name=$1 WHERE id=$2', [fixed, r.id]);
        changed += res.rowCount || 0;
      }
    }
  } catch (e) { console.error('[departments] master re-case failed:', e.message); }

  // Read once, after the re-casing above, and reused for every name below.
  const master = await listDepartments().catch(() => []);

  for (const [table, col] of DEPT_TEXT_COLUMNS) {
    try {
      // DISTINCT under a case-insensitive collation already collapses the
      // variants into one representative — updating on that representative
      // therefore rewrites every casing of it in one statement.
      const rows = await q(`SELECT DISTINCT ${col} AS d FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> ''`);
      for (const r of rows) {
        const canon = await canonicalDept(r.d, master);
        // Skip the ones already spelled correctly. Without this the repair
        // fires a full-table UPDATE per distinct department on every boot even
        // when there is nothing to fix — department is not indexed on any of
        // these tables, so on ims_transactions and daily_tasks that is a scan
        // and rewrite of the whole table, every restart.
        if (!canon || canon === r.d) continue;
        const res = await pool.query(`UPDATE ${table} SET ${col}=$1 WHERE ${col}=$2`, [canon, r.d]);
        changed += res.rowCount || 0;
      }
    } catch (e) {
      // A table that doesn't exist on this deployment (or an HR module that was
      // never migrated) must not stop the rest of the list being cleaned up.
      console.error(`[departments] re-case of ${table}.${col} failed:`, e.message);
    }
  }

  // PR requisitions keep a comma-joined list rather than one name, so they are
  // rewritten row by row instead of by distinct value.
  try {
    const rows = await q("SELECT id, department FROM pr_requisitions WHERE department IS NOT NULL AND department <> ''");
    for (const r of rows) {
      const fixed = await canonicalDeptList(r.department, master);
      if (fixed && fixed !== r.department) {
        const res = await pool.query('UPDATE pr_requisitions SET department=$1 WHERE id=$2', [fixed, r.id]);
        changed += res.rowCount || 0;
      }
    }
  } catch (e) { console.error('[departments] re-case of pr_requisitions failed:', e.message); }

  if (changed) console.log('[db] Department casing normalized on', changed, 'row(s)');
}

async function fixCollations() {
  if (!USE_DB) return;
  // Every table the app creates needs to be listed here, not just the ones a
  // query happens to JOIN today — a table left off this list keeps whatever
  // collation the MySQL server's default happened to be the day it was first
  // created (e.g. utf8mb4_uca1400_ai_ci on newer MySQL), while everything
  // below is force-normalized to utf8mb4_unicode_ci. payment_entries was
  // added after this list and missed it, so LEFT JOIN clients ON c.id =
  // pe.vendor_id (Payment History) failed with "Illegal mix of collations" —
  // add new tables here the same day they're added to SCHEMA above.
  const tables = ['users','delegations','masters','clients','checklist_completions','daily_tasks','leaves','user_sessions',
    'fms_sheets','fms_sheet_steps','fms_step_doers','fms_extra_rows','fms_intake_fields',
    'holidays','profile','app_config','dev_backups','help_tickets','announcements',
    'vendor_submissions','pr_requisitions','payment_entries','ims_items','ims_transactions','departments',
    'hr_employees','hr_salary_structure','hr_leave_types','hr_leave_balances','hr_attendance',
    'hr_payroll_runs','hr_payslips','hr_onboarding','hr_exits','hr_documents'];
  // A couple of these tables carry a leftover FOREIGN KEY constraint from an
  // earlier schema iteration (the current schema style is FK-less, app-generated
  // string ids) that blocks ALTER ... CONVERT TO CHARACTER SET on either side of
  // the relationship. Drop any such constraint touching these tables first —
  // best-effort, never re-added, matching the rest of the schema's FK-less design.
  try {
    const fks = await q(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, REFERENCED_TABLE_NAME AS referencedTableName FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`);
    const seen = new Set();
    for (const fk of fks) {
      const key = fk.tableName + '.' + fk.constraintName;
      if (seen.has(key) || !(tables.includes(fk.tableName) || tables.includes(fk.referencedTableName))) continue;
      seen.add(key);
      try { await pool.query(`ALTER TABLE ${fk.tableName} DROP FOREIGN KEY ${fk.constraintName}`); }
      catch (e) { console.error('[db] drop FK failed for', fk.tableName, fk.constraintName, '—', e.message); }
    }
  } catch (e) { console.error('[db] FK lookup failed:', e.message); }

  for (const t of tables) {
    try { await pool.query(`ALTER TABLE ${t} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
    catch (e) { console.error('[db] collation fix failed for', t, '—', e.message); }
  }
  // Add vendor columns to existing clients tables (no-op if already present)
  const vendorCols = [
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS mobile VARCHAR(64) DEFAULT ''`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS state VARCHAR(128) DEFAULT ''`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS district VARCHAR(128) DEFAULT ''`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT DEFAULT NULL`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS pin VARCHAR(16) DEFAULT ''`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255) DEFAULT ''`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_holder VARCHAR(255) DEFAULT ''`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_no VARCHAR(64) DEFAULT ''`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS ifsc_code VARCHAR(32) DEFAULT ''`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS branch_name VARCHAR(255) DEFAULT ''`,
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS division VARCHAR(64) DEFAULT ''`,
  ];
  for (const sql of vendorCols) {
    try { await pool.query(sql); } catch (_) {}
  }
}

// One-time best-effort migration for pre-existing DBs: users.email used to be UNIQUE
// on its own; multiple employees can now share one email (e.g. a shared department
// inbox), so uniqueness moved to the (name, email) pair. Each statement is tried
// independently so an already-migrated DB (or a fresh one created from SCHEMA above,
// which never had the old constraint) just no-ops through every attempt.
async function relaxEmailUnique() {
  if (!USE_DB) return;
  const attempts = [
    `ALTER TABLE users DROP INDEX email`,
    `ALTER TABLE users DROP CONSTRAINT users_email_key`,
    `ALTER TABLE users ADD CONSTRAINT users_name_email_key UNIQUE (name, email)`,
    `ALTER TABLE users ADD UNIQUE INDEX users_name_email_key (name, email)`,
    `CREATE INDEX idx_users_email ON users (email)`,
  ];
  for (const sql of attempts) {
    try { await pool.query(sql); } catch (_) {}
  }
}

async function ensureSchema() {
  if (!USE_DB) return;
  if (g.__pg_schema_ready) return g.__pg_schema_ready;
  g.__pg_schema_ready = (async () => {
    for (const stmt of SCHEMA) {
      try { await pool.query(stmt); }
      catch (e) {
        const code = e.code || '';
        const alreadyExists = code.match(/^(ER_TABLE_EXISTS_ERROR|ER_DUP_KEYNAME|42P07|42710)$/) || e.message?.includes('already exists');
        // A single bad/unexpected statement (e.g. one index on one MySQL version) must
        // never take down every route in the app for the rest of the process's life —
        // this promise is cached and reused by every request. Log and keep going instead.
        if (!alreadyExists) console.error('[db] schema statement failed (continuing):', stmt.slice(0, 90), '—', e.message);
      }
    }
    await seedIfEmpty().catch((e) => console.error('[db] seedIfEmpty failed:', e.message));
    await seedDepartments().catch((e) => console.error('[db] seedDepartments failed:', e.message));
    // These must all be awaited, not fire-and-forget: g.__pg_schema_ready is cached
    // and returned instantly to every future ensureSchema() caller the moment this
    // IIFE resolves, so an un-awaited background fix here would race every request
    // that runs before it happens to finish (e.g. collation-dependent JOINs failing
    // intermittently right after a cold start).
    await fixCollations().catch((e) => console.error('[db] fixCollations failed:', e.message));
    await relaxEmailUnique().catch((e) => console.error('[db] relaxEmailUnique failed:', e.message));
  })();

  /* The department casing repair runs AFTER the schema is ready, and is
     deliberately not awaited.
     ---------------------------------------------------------------------
     Everything above must block: a request that runs before the tables exist
     or before the collations are normalized gets wrong answers. This one is
     different — it only corrects how a department is spelled. Awaiting it put
     it in front of every request in the app, including /api/auth/login, and a
     pass over the larger tables took long enough that nobody could sign in at
     all. Cosmetic repair is never worth an outage.

     Left to finish on its own it converges within seconds of a cold start, and
     it is idempotent, so the worst case is a page showing "PACKING DEPT."
     instead of "Packing Dept." for a moment after a restart. */
  g.__pg_schema_ready.then(() => {
    normalizeDepartmentCase().catch((e) => console.error('[db] normalizeDepartmentCase failed:', e.message));
  }).catch(() => {});

  return g.__pg_schema_ready;
}

function toIso(v) { if (!v) return null; if (v instanceof Date) return v.toISOString(); return v; }
function toDateStr(v) { if (!v) return null; if (v instanceof Date) return v.toISOString().slice(0,10); if (typeof v==='string') return v.slice(0,10); return null; }

// ── JSON store (no-DB fallback) ───────────────────────────────────────────────
const fs = require('fs').promises;
const pathMod = require('path');
const DATA_DIR = pathMod.join(__dirname, 'database');
const STORE_FILE = pathMod.join(DATA_DIR, 'store.json');
const USE_DB = !!g.__db_pool;

const CACHE_TTL_MS = Number(process.env.STORE_CACHE_TTL_MS || 30000);
if (!g.__store_cache) g.__store_cache = { data: null, version: -1, at: 0 };

function cloneData(data) {
  return typeof structuredClone === 'function' ? structuredClone(data) : JSON.parse(JSON.stringify(data));
}

async function ensureStoreJson() {
  try { await fs.access(STORE_FILE); }
  catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const initial = { users: [], delegations: [], masters: [], holidays: [], approvals: { tasks:[], transfers:[], leaves:[] }, profile: {} };
    await fs.writeFile(STORE_FILE, JSON.stringify(initial, null, 2));
  }
}

async function readStoreJson() {
  await ensureStoreJson();
  return JSON.parse(await fs.readFile(STORE_FILE, 'utf8'));
}

async function writeStoreJson(data) {
  await ensureStoreJson();
  await fs.writeFile(STORE_FILE, JSON.stringify(data, null, 2));
}

// store-postgres read
function userOut(r) {
  let roles;
  if (Array.isArray(r.roles)) roles = r.roles;
  else if (typeof r.roles === 'string') roles = r.roles.split(',').map(x => x.trim()).filter(Boolean);
  else roles = ['User'];
  let permissions = null;
  try { if (r.permissions) permissions = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions; } catch {}
  return { id:r.id, name:r.name, email:r.email, phone:r.phone||'', department:r.department||'', roles, active:!!r.active, picture:r.picture||null, permissions, createdAt:toIso(r.created_at) };
}

async function readStoreDb() {
  await ensureSchema();
  const [users, delegations, masters, holidays, profileRows, completedMasters] = await Promise.all([
    q('SELECT * FROM users ORDER BY id ASC'),
    q('SELECT * FROM delegations ORDER BY id ASC'),
    q('SELECT * FROM masters ORDER BY id ASC'),
    q('SELECT * FROM holidays ORDER BY date ASC'),
    q('SELECT * FROM profile LIMIT 1'),
    // Each masters row is one dated occurrence (recurring series are pre-generated as
    // separate rows), so a checklist item is "done" once it has any completion at all —
    // not just one recorded today.
    q('SELECT DISTINCT master_id FROM checklist_completions'),
  ]);
  const profile = profileRows[0] ? { userId:profileRows[0].user_id, notificationEmail:profileRows[0].notification_email||'' } : { userId:null, notificationEmail:'' };
  return {
    users: users.map(userOut),
    delegations: delegations.map(r => ({ id:r.id, description:r.description, doerId:r.doer_id, doer:r.doer, delegatedBy:r.delegated_by, dueDate:toDateStr(r.due_date), client:r.client||'', status:r.status, type:r.type, priority:r.priority||'Low', url:r.url||'', approval:r.approval||'No Approval', remarks:r.remarks||'', transferredBy:r.transferred_by||null, transferredFrom:r.transferred_from||null, createdAt:toIso(r.created_at), completedAt:toIso(r.completed_at) })),
    masters: masters.map(r => ({ id:r.id, task:r.task, assignedTo:r.assigned_to||'', department:r.department||'', frequency:r.frequency, startDate:toDateStr(r.start_date), endDate:toDateStr(r.end_date), remarks:r.remarks||'', createdAt:toIso(r.created_at) })),
    holidays: holidays.map(r => ({ id:r.id, date:toDateStr(r.date), name:r.name, type:r.type||'' })),
    approvals:{ tasks:[], transfers:[], leaves:[] }, profile,
    completedMasterIds: completedMasters.map(r => r.master_id),
  };
}

async function readStore() { return USE_DB ? readStoreDb() : readStoreJson(); }

async function writeStoreDb(data) {
  await ensureSchema();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM users'); await c.query('DELETE FROM delegations');
    await c.query('DELETE FROM masters'); await c.query('DELETE FROM holidays'); await c.query('DELETE FROM profile');
    for (const u of data.users||[]) {
      await c.query(`INSERT INTO users (id,name,email,phone,department,roles,active,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,NOW()))`,
        [u.id,u.name,u.email,u.phone||'',u.department||'',(u.roles&&u.roles.length?u.roles:['User']).join(','),u.active===false?0:1,u.createdAt||null]);
    }
    for (const d of data.delegations||[]) {
      await c.query(`INSERT INTO delegations (id,description,doer_id,doer,delegated_by,due_date,client,status,type,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz,NOW()))`,
        [d.id,d.description,d.doerId||null,d.doer||'',d.delegatedBy||null,d.dueDate||null,d.client||'',d.status||'pending',d.type||'delegation',d.createdAt||null]);
    }
    for (const m of data.masters||[]) {
      await c.query(`INSERT INTO masters (id,task,assigned_to,frequency,start_date,end_date,remarks,department,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,NOW()))`,
        [m.id,m.task,m.assignedTo||'',m.frequency||'Daily',m.startDate||null,m.endDate||null,m.remarks||'',m.department||'',m.createdAt||null]);
    }
    for (const h of data.holidays||[]) { await c.query(`INSERT INTO holidays (id,date,name,type) VALUES ($1,$2,$3,$4)`, [h.id,h.date,h.name,h.type||'']); }
    if (data.profile?.userId) await c.query(`INSERT INTO profile (user_id,notification_email) VALUES ($1,$2)`, [data.profile.userId,data.profile.notificationEmail||'']);
    bumpStoreVersion();
    await c.query('COMMIT');
  } catch (err) { await c.query('ROLLBACK'); throw err; }
  finally { c.release(); }
}

async function writeStore(data) { return USE_DB ? writeStoreDb(data) : writeStoreJson(data); }

function computeDashboard(store, filter='all', doerFilter='') {
  let total=0, completed=0, pending=0, revised=0, upcoming=0;
  const items=[];
  const now=new Date(); now.setHours(0,0,0,0);
  // doerFilter is either '' (no filter — everyone), a single name (string, matched
  // case-insensitively), or a Set of lowercased names (team-scope match — used for
  // an HOD's "All (My Team)" view, see /api/dashboard below).
  const teamSet = doerFilter instanceof Set ? doerFilter : null;
  const df = (!teamSet && doerFilter) ? doerFilter.trim().toLowerCase() : '';
  const matchesDoer = name => {
    const n = (name || '').trim().toLowerCase();
    return teamSet ? teamSet.has(n) : (!df || n === df);
  };
  if (filter==='all'||filter==='delegation') {
    (store.delegations||[]).forEach(d => {
      if (!matchesDoer(d.doer)) return;
      total++;
      const due = new Date(d.dueDate||d.due_date); due.setHours(0,0,0,0);
      if (d.status==='done') {
        completed++;
        items.push({ id:d.id, doerId:d.doerId, type:'Delegation', description:d.description, doer:d.doer, date:d.dueDate||d.due_date, client:d.client||'-', overdue:false, status:'done', priority:d.priority||'Low', url:d.url||'', remarks:d.remarks||'', transferredBy:d.transferredBy||null, transferredFrom:d.transferredFrom||null, createdAt:d.createdAt||d.created_at });
      } else {
        pending++;
        if (d.status==='revise'||d.status==='revise_requested') revised++;
        const isOverdue = due < now;
        if (due > now) upcoming++;
        items.push({ id:d.id, doerId:d.doerId, type:'Delegation', description:d.description, doer:d.doer, date:d.dueDate||d.due_date, client:d.client||'-', overdue:isOverdue, status:d.status||'pending', priority:d.priority||'Low', url:d.url||'', remarks:d.remarks||'', transferredBy:d.transferredBy||null, transferredFrom:d.transferredFrom||null, createdAt:d.createdAt||d.created_at });
      }
    });
  }
  if (filter==='all'||filter==='checklist') {
    const doneIds = new Set(store.completedMasterIds || []);
    (store.masters||[]).forEach(m => {
      if (!matchesDoer(m.assignedTo)) return;
      total++;
      const dateStr = m.startDate || now.toISOString();
      if (doneIds.has(m.id)) {
        completed++;
        items.push({ id:m.id, doerId:m.doerId||null, type:'Checklist', description:m.task, doer:m.assignedTo, department:m.department||'', frequency:m.frequency||'', date:dateStr, client:'-', overdue:false, status:'done', remarks:m.remarks||'', createdAt:m.createdAt||m.created_at });
        return;
      }
      const due = new Date(dateStr); due.setHours(0,0,0,0);
      if (m.startDate && due > now) return; // not due yet — don't count as pending or show in the list
      const isOverdue = m.startDate ? due < now : false;
      pending++;
      items.push({ id:m.id, doerId:m.doerId||null, type:'Checklist', description:m.task, doer:m.assignedTo, department:m.department||'', frequency:m.frequency||'', date:dateStr, client:'-', overdue:isOverdue, status:'pending', remarks:m.remarks||'', createdAt:m.createdAt||m.created_at });
    });
  }
  return { total, completed, pending, revised, upcoming, pendingTasks:items.sort((a,b)=>new Date(b.createdAt||b.date)-new Date(a.createdAt||a.date)).slice(0,1000) };
}

function normDate(s) {
  if (!s) return null;
  const t = String(s).trim().replace(/\//g,'-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

function parseRoles(role, userRole) {
  const combined = [role, userRole].join(',').toLowerCase();
  const roles=[];
  if (combined.includes('admin')) roles.push('Admin');
  if (combined.includes('hod')) roles.push('HOD');
  if (combined.includes('user')) roles.push('User');
  return roles.length ? roles : ['User'];
}

// ── Google Sheets sync (optional) ────────────────────────────────────────────
async function syncUsers_gs() {
  try {
    const { google } = require('googleapis');
    const SPREADSHEET_ID = '1uVHOQ8OSuah5JarpgR_2fkD7Mwdfu-6yWEMgJWfv9Nw';
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
    if (!email||!key) return;
    const auth = new google.auth.GoogleAuth({ credentials:{client_email:email,private_key:key}, scopes:['https://www.googleapis.com/auth/spreadsheets'] });
    const sheets = google.sheets({ version:'v4', auth });
    const rows = await sql`SELECT * FROM users ORDER BY id`;
    const values = rows.map(u => [u.id,u.name,u.email,u.phone||'',u.department||'',u.branch||'',(Array.isArray(u.roles)?u.roles:[u.roles]).filter(Boolean).join(', '),u.active?'Yes':'No',u.created_at?new Date(u.created_at).toLocaleString('en-IN'):'']);
    const meta = await sheets.spreadsheets.get({ spreadsheetId:SPREADSHEET_ID });
    const exists = meta.data.sheets.some(s=>s.properties.title==='Users');
    if (!exists) await sheets.spreadsheets.batchUpdate({ spreadsheetId:SPREADSHEET_ID, requestBody:{requests:[{addSheet:{properties:{title:'Users'}}}]} });
    await sheets.spreadsheets.values.update({ spreadsheetId:SPREADSHEET_ID, range:'Users!A1', valueInputOption:'RAW', requestBody:{values:[['ID','Name','Email','Phone','Department','Branch','Roles','Active','Created At']]} });
    await sheets.spreadsheets.values.clear({ spreadsheetId:SPREADSHEET_ID, range:'Users!A2:Z10000' });
    if (values.length>0) await sheets.spreadsheets.values.update({ spreadsheetId:SPREADSHEET_ID, range:'Users!A2', valueInputOption:'RAW', requestBody:{values} });
  } catch (err) { console.error('[Sheets] Users sync failed:', err.message); }
}

// ── Backup helpers ────────────────────────────────────────────────────────────
async function ensureBackupTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS dev_backups (id VARCHAR(64) PRIMARY KEY, label VARCHAR(128) NOT NULL DEFAULT '', data TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL)`);
}

async function createBackup(label='auto') {
  await ensureBackupTable();
  const dels = await q('SELECT * FROM delegations');
  const masters = await q('SELECT * FROM masters');
  const users = await q('SELECT * FROM users');
  const hols = await q('SELECT * FROM holidays').catch(()=>[]);
  const data = JSON.stringify({ delegations:dels, masters, users, holidays:hols });
  const id = 'BKP_'+Date.now()+'_'+Math.random().toString(36).slice(2,6).toUpperCase();
  await pool.query("INSERT INTO dev_backups (id,label,data,expires_at) VALUES ($1,$2,$3,(NOW()+INTERVAL '15 DAY'))", [id,label,data]);
  return id;
}

// ── DB-backed session store (falls back to MemoryStore if no DB) ──────────────
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

class DbSessionStore extends session.Store {
  constructor() {
    super();
    // create table immediately so it exists before first session read/write
    // Sequential, not fire-and-forget: the ALTER has to land after the CREATE
    // and the backfill after the ALTER, or each one fails on a column/table
    // that does not exist yet and gets silently swallowed.
    this.ready = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS user_sessions (sid VARCHAR(128) PRIMARY KEY, data TEXT NOT NULL, expires_at DATETIME NOT NULL, user_id VARCHAR(64) NULL, INDEX idx_user_sessions_user (user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      ).catch(() => {});
      // Rows written before user_id existed carry the owner only inside the
      // JSON blob, so add the column and backfill it — otherwise "sign out
      // everywhere" would quietly miss every session predating this deploy.
      await pool.query(`ALTER TABLE user_sessions ADD COLUMN user_id VARCHAR(64) NULL`).catch(() => {});
      await pool.query(`CREATE INDEX idx_user_sessions_user ON user_sessions (user_id)`).catch(() => {});
      await this.backfillUserIds().catch(() => {});
    })();
  }

  // Cheap: only ever touches rows that have no user_id yet.
  backfillUserIds() {
    return pool.query(
      `UPDATE user_sessions SET user_id = JSON_UNQUOTE(JSON_EXTRACT(data, '$.user.id'))
        WHERE user_id IS NULL AND data LIKE '%"user"%'`
    );
  }

  // Every stored session for one user — this is what signs them out everywhere.
  destroyByUser(userId) {
    return pool.query('DELETE FROM user_sessions WHERE user_id = $1', [String(userId)]);
  }

  // Everyone except one session. Used for the bulk sign-out, where keeping the
  // caller signed in is the difference between a usable button and one that
  // locks the admin out of the page they just clicked it on.
  destroyAllExcept(keepSid) {
    return pool.query('DELETE FROM user_sessions WHERE sid <> $1', [String(keepSid || '')]);
  }
  get(sid, cb) {
    pool.query('SELECT data, expires_at FROM user_sessions WHERE sid = $1', [sid])
      .then(({ rows }) => {
        if (!rows.length) return cb(null, null);
        if (new Date(rows[0].expires_at) < new Date()) {
          this.destroy(sid, () => {});
          return cb(null, null);
        }
        try { cb(null, JSON.parse(rows[0].data)); } catch { cb(null, null); }
      }).catch(() => cb(null, null));
  }
  // Every authenticated request lands here (via touch), so this is the one
  // method that must not get more fragile. Two guards: wait for the migration
  // so the first write after a deploy can't race the ALTER, and fall back to
  // the original user_id-less write if that column is unavailable for any
  // reason — a session that stores without user_id still logs the user in.
  set(sid, sess, cb) {
    const exp = new Date(Date.now() + SESSION_TTL_MS);
    const data = JSON.stringify(sess);
    const uid = sess?.user?.id ? String(sess.user.id) : null;
    const legacy = () => pool.query(
      `INSERT INTO user_sessions (sid, data, expires_at) VALUES ($1,$2,$3) ON CONFLICT (sid) DO UPDATE SET data=$4, expires_at=$5`,
      [sid, data, exp, data, exp]
    );
    Promise.resolve(this.ready)
      .catch(() => {})
      .then(() => pool.query(
        `INSERT INTO user_sessions (sid, data, expires_at, user_id) VALUES ($1,$2,$3,$4) ON CONFLICT (sid) DO UPDATE SET data=$5, expires_at=$6, user_id=$7`,
        [sid, data, exp, uid, data, exp, uid]
      ).catch(legacy))
      .then(() => cb(null)).catch(() => cb(null));
  }
  destroy(sid, cb) {
    pool.query('DELETE FROM user_sessions WHERE sid = $1', [sid])
      .then(() => cb(null)).catch(() => cb(null));
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
const sessionStore = USE_DB ? new DbSessionStore() : null;
app.use(session({
  store: sessionStore || undefined,
  secret: process.env.NEXTAUTH_SECRET || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SESSION_TTL_MS,
  },
}));

// ── Sample CSV downloads ──────────────────────────────────────────────────
// Served from /api/samples/* (not /public) and as application/octet-stream:
// Hostinger's hcdn edge layer intercepts and serves any request matching a
// static file under /public directly, bypassing Express entirely — so a
// route at the bare /*.csv path (or relying on res.download()'s Content-Type,
// which is reset by extension) never actually runs. Routing under /api/
// guarantees this hits the Node app, and octet-stream stops the browser from
// sniffing the plain-text CSV content and renaming the download to .txt.
const SAMPLE_FILES = {
  'checklist-bulk': 'checklist_bulk_sample.csv',
  'delegation':     'delegation_sample.csv',
  'holiday':        'holiday_sample.csv',
};
app.get('/api/samples/:key', (req, res) => {
  const name = SAMPLE_FILES[req.params.key];
  if (!name) return res.status(404).end();
  res.set({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name}"`,
  });
  res.sendFile(path.join(__dirname, 'samples', name));
});

// HTML shells (app.html etc.) must never be cached — they're what pins down
// which ?v=N of each page script gets loaded, so a stale cached HTML file
// silently keeps serving an old script version forever. Other static assets
// (JS/CSS/images) keep express.static's normal caching.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  },
}));

// ── Middleware ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireAdmin(req, res, next) {
  if (!isAdminUser(req.session?.user)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Admin or HOD by role — plus the owner, always. The owner account is the most
// privileged one in the app: it alone deletes records, reopens a finalised
// payroll and imports the HRMS sheet. Whether it also carries the "Admin" role
// is a data question, and it used to be the only thing standing between the
// owner and a 403 on every admin route — or, worse, being quietly scoped down
// to their own leave and payslips by the HR module, which reads company-wide
// access from this same function. The owner outranks Admin, so it can never
// see less than one.
function isAdminUser(user) {
  if (isSuperAdmin(user)) return true;
  const roles = user?.roles || [];
  const rolesArr = Array.isArray(roles) ? roles : String(roles).split(',').map(r=>r.trim());
  return rolesArr.includes('Admin') || rolesArr.includes('HOD');
}

// ── Owner-only delete ────────────────────────────────────────────────────────
// One person can delete records outright from every module's list. This is NOT
// a role and NOT a permission: Admin and HOD do not get it, and it cannot be
// granted from Users → Access. Every other destructive action in this app is a
// Cancel that keeps the row and its paper trail; this one removes the record,
// so it is deliberately hard-coded where no screen can hand it out by mistake.
//
// The owner's ERP LOGIN email. Blank it and the delete goes dead everywhere:
// no button renders and every delete route answers 403. Matched
// case-insensitively, so the login's own capitalisation does not matter.
const SUPER_ADMIN_EMAIL = 'Admin@lal.com';

function isSuperAdmin(user) {
  const want = String(SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!want) return false;
  return String(user?.email || '').trim().toLowerCase() === want;
}

// The real gate. Hiding the button in the UI is cosmetic — without this guard
// anyone could still call the route by hand.
function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.session?.user)) return res.status(403).json({ error: 'Not allowed' });
  next();
}

/* The signed-in user as the browser should see them.
   ---------------------------------------------------------------------
   Server-side, the owner already counts as an Admin (see isAdminUser). The
   frontend has to reach the same conclusion or it hides screens the API
   would happily serve — and roughly twenty places across the older pages
   (Approvals, All Tasks, FMS, PI, the masters) each read
   `currentUser.roles` and test for 'Admin'/'HOD' themselves.

   Rather than edit every one of those, the owner is handed 'Admin' among
   its roles on the way out. One place, so the two sides cannot drift, and
   no page needs to know the owner exists.

   This is a view of the user, not the user: the roles column in the
   database is untouched, nothing writes this back, and `isSuperAdmin` on
   the same object stays the real answer to "is this the owner". */
function clientUser(user, extra = {}) {
  const roles = Array.isArray(user?.roles)
    ? user.roles.slice()
    : String(user?.roles || '').split(',').map(r => r.trim()).filter(Boolean);
  if (isSuperAdmin(user) && !roles.includes('Admin')) roles.push('Admin');
  return { ...user, roles, featureFlags: { fms: FMS_ENABLED }, isSuperAdmin: isSuperAdmin(user), ...extra };
}

// Distinguishes "sees the whole company" (Admin) from "sees their own department's
// team" (HOD) — isAdminUser() above intentionally treats them the same for feature
// gating (edit/delete/etc.), but task VISIBILITY must not: only true Admin sees
// everyone, HOD is scoped to their own department, plain User to just themselves.
function isTrueAdminUser(user) {
  const roles = user?.roles || [];
  const rolesArr = Array.isArray(roles) ? roles : String(roles).split(',').map(r=>r.trim());
  return rolesArr.includes('Admin');
}
function isHODUser(user) {
  const roles = user?.roles || [];
  const rolesArr = Array.isArray(roles) ? roles : String(roles).split(',').map(r=>r.trim());
  return rolesArr.includes('HOD') && !isTrueAdminUser(user);
}

// `department` is free text (Users admin has "+ Add new department" alongside a
// dropdown of existing values), so two team members can end up with the "same"
// department that differs only in case or stray whitespace (e.g. a CSV import).
// Every HOD team-scoping comparison MUST go through this — a raw `===` silently
// drops teammates whose department string doesn't byte-for-byte match the HOD's,
// which looks exactly like "HOD only sees their own tasks, never the team's".
function normDept(d) {
  return (d || '').trim().toLowerCase();
}

// req.session.user never carries `permissions` itself (only /api/auth/session
// fetches it fresh, see below) — so any route-level feature gate needs its
// own fresh lookup, scoped to just the one column rather than pulling in
// readStore()'s full app-state read.
async function getUserPermissions(userId) {
  if (!userId) return null;
  try {
    if (USE_DB) {
      const rows = await q('SELECT permissions FROM users WHERE id = $1', [userId]);
      const raw = rows[0]?.permissions;
      return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    }
    const store = await readStoreJson();
    const su = (store.users || []).find(u => u.id === userId);
    return su?.permissions || null;
  } catch { return null; }
}

// Server-side mirror of the frontend's hasFeature()/_hasFeature() pattern
// (e.g. all-tasks.js, client-master.js) — a page-level feature is blocked by
// default the moment a user has ANY saved `permissions.features` object
// (defaultPermissionsFor() gives every new non-admin user `features: {}`)
// unless that specific page+feature was explicitly checked from the Users →
// Access tab. Admin/HOD always pass. Must be kept in sync with the frontend
// version — this is the one place a feature gate is actually enforced
// server-side rather than just hidden in the UI (PO/PR/GRN never needed
// this: every action there is open to any authenticated user).
async function userCanUseFeature(user, page, feat) {
  if (isAdminUser(user)) return true;
  const perms = await getUserPermissions(user?.id);
  if (!perms || !perms.features) return true;
  const pageFeats = perms.features[page];
  if (!pageFeats) return false;
  return pageFeats.includes(feat);
}

function checkSecret(req) {
  const secret = req.query.secret;
  return secret && secret === process.env.DEVELOPER_SECRET;
}

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    let { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    email = email.trim();
    name = (name || '').trim();

    // Check app_active
    let appActive = true;
    if (USE_DB) {
      try {
        const { rows } = await pool.query(`SELECT "value" FROM app_config WHERE "key" = 'app_active'`);
        if (rows.length > 0) appActive = rows[0].value !== 'false';
      } catch { appActive = true; }
    }
    if (!appActive) return res.status(403).json({ error: 'App is currently disabled' });

    // Multiple accounts can share the same email (e.g. a shared department inbox) —
    // name only needs to be collected when the email alone doesn't resolve to one user.
    let matches = [];
    if (USE_DB) {
      try {
        await ensureSchema();
        const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND active = 1', [email]);
        matches = rows;
      } catch (err) {
        console.error('[auth] Postgres error:', err.message);
      }
    }
    if (!matches.length) {
      try {
        // Auto-seed admin on first login attempt if store is empty
        await seedJsonFallback();
        const store = await readStore();
        matches = (store.users || []).filter(u => (u.email||'').toLowerCase() === email.toLowerCase() && u.active !== false);
      } catch (err) {
        console.error('[auth] store error:', err.message);
      }
    }
    if (!matches.length) return res.status(401).json({ error: 'Invalid credentials' });

    let user = null;
    if (matches.length === 1) {
      user = matches[0];
    } else if (!name) {
      return res.status(409).json({ error: 'Multiple accounts use this email. Please also enter your name.', needsName: true });
    } else {
      const named = matches.filter(u => (u.name||'').trim().toLowerCase() === name.toLowerCase());
      if (named.length !== 1) return res.status(401).json({ error: 'Invalid credentials' });
      user = named[0];
    }

    if (!user.password_hash) {
      if (password !== DEFAULT_PASSWORD) return res.status(401).json({ error: 'Invalid credentials' });
    } else {
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    }

    const roles = Array.isArray(user.roles)
      ? user.roles
      : typeof user.roles === 'string'
      ? user.roles.split(',').map(r => r.trim()).filter(Boolean)
      : ['User'];

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      department: user.department || '',
      roles,
    };
    // Include permissions here too, not just in /api/auth/session: login.js sets
    // window.currentUser straight from this response and renders the sidebar off
    // it, so without permissions a restricted user sees the FULL menu until a
    // hard reload (which re-bootstraps via /api/auth/session). parsePermissions
    // handles the raw JSON-string (DB) / object (store) / null cases alike.
    return res.json({ user: clientUser(req.session.user, { picture: user.picture || null, permissions: parsePermissions(user.permissions) }) });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/session', async (req, res) => {
  const u = req.session?.user || null;
  if (!u) return res.json({ user: null });
  try {
    let picture = null, permissions = null;
    if (USE_DB) {
      const rows = await q('SELECT picture, permissions FROM users WHERE id = $1', [u.id]);
      picture = rows[0]?.picture || null;
      try { if (rows[0]?.permissions) permissions = JSON.parse(rows[0].permissions); } catch {}
    } else {
      const store = await readStoreJson();
      const su = (store.users || []).find(x => x.id === u.id);
      picture = su?.picture || null;
      permissions = su?.permissions || null;
    }
    return res.json({ user: clientUser(u, { picture, permissions }) });
  } catch {
    return res.json({ user: clientUser(u) });
  }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', requireAuth, async (req, res) => {
  const store = await readStore();
  const user = req.session.user;
  const trueAdmin = isTrueAdminUser(user);
  const hod = isHODUser(user);

  // Who computeDashboard()/FMS should scope to:
  // - True Admin: no ?doer (or ?doer=All) → everyone company-wide; ?doer=<name> → just that person.
  // - HOD: no ?doer → just themselves (personal default, like a plain user);
  //   ?doer=All → their whole department team; ?doer=<name> → one teammate.
  //   Never the whole company.
  // - Everyone else: always just themselves, regardless of any ?doer passed in.
  let doerFilter = user.name || '';
  let fmsUserId = user.id, fmsUserName = user.name, fmsIsAdmin = false, fmsTeamSet = null;

  if (trueAdmin) {
    const doer = req.query.doer || '';
    if (doer && doer !== 'All') {
      doerFilter = doer;
      const target = (store.users || []).find(u => (u.name || '').trim().toLowerCase() === doer.trim().toLowerCase());
      fmsUserId = target ? target.id : null;
      fmsUserName = doer;
    } else {
      doerFilter = '';
      fmsIsAdmin = true;
    }
  } else if (hod) {
    const doer = req.query.doer || '';
    if (doer === 'All') {
      // Look up the HOD's OWN department fresh off store.users (keyed by the stable
      // id) rather than trusting req.session.user.department — the session is a
      // snapshot from login time (sessions live up to 30 days), so if a department
      // was assigned/renamed after that login, the cached string silently no
      // longer matches anyone, including the HOD's own department, and "All (My
      // Team)" resolves to an empty team instead of erroring.
      const myFreshDept = (store.users || []).find(u => u.id === user.id)?.department ?? user.department;
      fmsTeamSet = new Set((store.users || []).filter(u => normDept(u.department) === normDept(myFreshDept)).map(u => (u.name || '').trim().toLowerCase()));
      doerFilter = fmsTeamSet;
    } else if (doer) {
      doerFilter = doer;
      const target = (store.users || []).find(u => (u.name || '').trim().toLowerCase() === doer.trim().toLowerCase());
      fmsUserId = target ? target.id : null;
      fmsUserName = doer;
    }
    // else: falls through to the personal default set above.
  }

  const result = computeDashboard(store, 'all', doerFilter);

  if (FMS_ENABLED) {
    try {
      let fmsTasks;
      if (fmsTeamSet) {
        // getMyFmsPendingRows() has no notion of "team" — pull everything and
        // post-filter to the HOD's department, mirroring the Set-scoping above.
        const all = await fmsSheet.getMyFmsPendingRows({ userId: null, userName: null, isAdmin: true });
        fmsTasks = all.filter(t => fmsTeamSet.has((t.doer || '').trim().toLowerCase()));
      } else {
        fmsTasks = (fmsIsAdmin || fmsUserId) ? await fmsSheet.getMyFmsPendingRows({ userId: fmsUserId, userName: fmsUserName, isAdmin: fmsIsAdmin }) : [];
      }
      result.total += fmsTasks.length;
      result.pending += fmsTasks.length;
      result.pendingTasks = result.pendingTasks.concat(fmsTasks)
        .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date))
        .slice(0, 1000);
    } catch (e) {
      console.error('[fms] dashboard merge failed:', e.message);
    }
  }

  return res.json(result);
});

// ── Delegations ───────────────────────────────────────────────────────────────
app.get('/api/delegations', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { filter, myRevise } = req.query;
    const sessUser = req.session?.user;
    const userId = sessUser?.id;
    const userName = sessUser?.name || '';
    const isAdmin = isAdminUser(sessUser);
    const isHOD = isHODUser(sessUser);

    if (!USE_DB) {
      const store = await readStore();
      let rows = (store.delegations || []).map(d => ({
        id: d.id, description: d.description, doerId: d.doerId, doer: d.doer,
        delegatedBy: d.delegatedBy, dueDate: d.dueDate || d.due_date, client: d.client || '',
        status: d.status, type: d.type, priority: d.priority || 'Low',
        approval: d.approval || 'No Approval', url: d.url || '', remarks: d.remarks || '',
        createdAt: d.createdAt, completedAt: d.completedAt || null,
        transferredBy: d.transferredBy || null, transferredFrom: d.transferredFrom || null,
      }));
      if (filter === 'revise_requested') rows = rows.filter(d => d.status === 'revise_requested');
      else if (filter === 'approval_required') rows = rows.filter(d => d.approval === 'Approval Required' && d.status === 'pending');
      else if (myRevise === 'true') rows = rows.filter(d => (d.doerId === userId || d.doer === userName) && d.status === 'revise');
      // HOD sees their department's team plus anything they personally own/delegated — not the whole company.
      // Department is looked up fresh off store.users by id, not off the (possibly
      // stale, up to 30-day-old) session — see the matching comment in /api/dashboard.
      else if (isHOD) {
        const myFreshDept = (store.users || []).find(u => u.id === userId)?.department || '';
        const teamNames = new Set((store.users || []).filter(u => normDept(u.department) === normDept(myFreshDept)).map(u => (u.name || '').toLowerCase()));
        rows = rows.filter(d => teamNames.has((d.doer || '').toLowerCase()) || d.doerId === userId || d.delegatedBy === userId);
      }
      // Plain users only ever see tasks assigned to them or delegated by them — never the whole company's.
      else if (!isAdmin) rows = rows.filter(d => d.doerId === userId || (d.doer || '').toLowerCase() === userName.toLowerCase() || d.delegatedBy === userId);
      return res.json(rows);
    }

    let sqlWhere = '';
    const params = [];
    if (filter === 'revise_requested') { sqlWhere = `WHERE status='revise_requested'`; }
    else if (filter === 'approval_required') { sqlWhere = `WHERE approval='Approval Required' AND status='pending'`; }
    else if (myRevise === 'true') {
      sqlWhere = `WHERE (doer_id=$1 OR doer=$2) AND status='revise'`;
      params.push(userId, userName);
    } else if (isHOD) {
      // Department subquery keys off the HOD's own id, never a cached session
      // string — see the /api/dashboard comment on why that matters.
      // NOTE: this app's MySQL path (pgToMysql()) rewrites every `$N` to a
      // positional `?` with no dedup — each occurrence needs its OWN param,
      // even when the value repeats (unlike native Postgres, which can reuse
      // $1). Never reuse a placeholder number here.
      sqlWhere = `WHERE doer_id IN (SELECT id FROM users WHERE LOWER(TRIM(department))=(SELECT LOWER(TRIM(department)) FROM users WHERE id=$1)) OR doer_id=$2 OR LOWER(doer)=LOWER($3) OR delegated_by=$4`;
      params.push(userId, userId, userName, userId);
    } else if (!isAdmin) {
      sqlWhere = `WHERE (doer_id=$1 OR LOWER(doer)=LOWER($2) OR delegated_by=$3)`;
      params.push(userId, userName, userId);
    }

    const rows = await q(`SELECT id, description, doer_id AS "doerId", doer, delegated_by AS "delegatedBy", due_date AS "dueDate", client, status, type, priority, approval, url, remarks, transferred_by AS "transferredBy", transferred_from AS "transferredFrom", created_at AS "createdAt", completed_at AS "completedAt" FROM delegations ${sqlWhere} ORDER BY created_at DESC`, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

async function nextDelId() {
  const rows = await q("SELECT MAX(CAST(SUBSTRING(id,4) AS UNSIGNED)) AS maxnum FROM delegations WHERE id REGEXP '^DEL[0-9]+'");
  const lastNum = (rows.length && rows[0].maxnum) ? parseInt(rows[0].maxnum)||0 : 0;
  return 'DEL' + (lastNum+1).toString().padStart(3,'0');
}

async function sendChecklistTransferEmail({ assignedTo, taskDesc, prevAssignee }) {
  const mailer = getMailer();
  if (!mailer) return;
  const uRows = await q('SELECT email, name FROM users WHERE name=$1 LIMIT 1', [assignedTo]);
  const toEmail = uRows[0]?.email, toName = uRows[0]?.name;
  if (!toEmail) return;
  await mailer.sendMail({
    from: `"Task Manager" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: `Checklist Task Transferred to You: ${taskDesc.slice(0,60)}`,
    html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <div style="background:#6366f1;padding:20px 24px">
        <h2 style="color:#fff;margin:0;font-size:16px">📋 Checklist Task Assigned to You</h2>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 12px;font-size:14px;color:#1e293b"><strong>Task:</strong> ${taskDesc}</p>
        ${prevAssignee ? `<p style="margin:0 0 8px;font-size:13px;color:#475569"><strong>Transferred from:</strong> ${prevAssignee}</p>` : ''}
        <p style="margin:0;font-size:13px;color:#94a3b8">Hi ${toName||''}, this recurring checklist task is now assigned to you.</p>
      </div>
    </div>`,
  });
}

async function resolveDelegator(task) {
  const delegatorId = task.delegated_by || task.delegatedBy;
  if (!delegatorId) return null;
  const uRows = await q('SELECT email, name FROM users WHERE id=$1 OR email=$2 LIMIT 1', [delegatorId, delegatorId]);
  return uRows[0] || null;
}

async function sendDelegationDoneEmail(task) {
  const mailer = getMailer();
  if (!mailer) return;
  const delegator = await resolveDelegator(task);
  if (!delegator?.email) return;
  await mailer.sendMail({
    from: `"Task Manager" <${process.env.SMTP_USER}>`,
    to: delegator.email,
    subject: `Task Completed: ${(task.description||'').slice(0,60)}`,
    html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <div style="background:#10b981;padding:20px 24px">
        <h2 style="color:#fff;margin:0;font-size:16px">✅ Task Marked Done</h2>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 12px;font-size:14px;color:#1e293b"><strong>Task:</strong> ${task.description||''}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#475569"><strong>Done by:</strong> ${task.doer||''}</p>
        <p style="margin:0;font-size:13px;color:#94a3b8">Hi ${delegator.name||''}, the above task has been completed.</p>
      </div>
    </div>`,
  });
}

async function sendDelegationShiftedEmail(task) {
  const mailer = getMailer();
  if (!mailer) return;
  const delegator = await resolveDelegator(task);
  if (!delegator?.email) return;
  await mailer.sendMail({
    from: `"Task Manager" <${process.env.SMTP_USER}>`,
    to: delegator.email,
    subject: `Task Shifted: ${(task.description||'').slice(0,60)}`,
    html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
      <div style="background:#f59e0b;padding:20px 24px">
        <h2 style="color:#fff;margin:0;font-size:16px">🔄 Task Shifted</h2>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 12px;font-size:14px;color:#1e293b"><strong>Task:</strong> ${task.description||''}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#475569"><strong>Shifted by:</strong> ${task.doer||''}</p>
        ${task.remarks ? `<p style="margin:0 0 8px;font-size:13px;color:#475569"><strong>Reason:</strong> ${task.remarks}</p>` : ''}
        ${task.due_date ? `<p style="margin:0 0 8px;font-size:13px;color:#475569"><strong>New Due Date:</strong> ${new Date(task.due_date).toLocaleDateString('en-IN')}</p>` : ''}
        <p style="margin:0;font-size:13px;color:#94a3b8">Hi ${delegator.name||''}, the above task has been shifted.</p>
      </div>
    </div>`,
  });
}

async function insertDelegation({ description, doerId, doerName, delegatedBy, dueDate, client, priority, approval, url, remarks }) {
  const id = await nextDelId();
  await pool.query(
    `INSERT INTO delegations (id,description,doer_id,doer,delegated_by,due_date,client,status,type,priority,approval,url,remarks,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'delegation',$9,$10,$11,$12,NOW())`,
    [id, description, doerId, doerName||'', delegatedBy||null, dueDate, client||'', 'pending', priority||'Low', approval||'No Approval', url||'', remarks||'']
  );
  const result = await q('SELECT * FROM delegations WHERE id = $1', [id]);
  return result[0];
}

app.post('/api/delegations', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    let doerIsAdmin = false;
    if (!USE_DB) {
      const store = await readStore();
      const doerUser = (store.users||[]).find(u=>u.id===body.doerId);
      const doerRoles = doerUser?.roles||[];
      doerIsAdmin = Array.isArray(doerRoles) ? doerRoles.includes('Admin')||doerRoles.includes('HOD') : String(doerRoles).includes('Admin')||String(doerRoles).includes('HOD');
    } else {
      try {
        await ensureSchema();
        const { rows } = await pool.query('SELECT roles FROM users WHERE id = $1', [body.doerId]);
        const dr = rows[0]?.roles||'';
        doerIsAdmin = dr.includes('Admin')||dr.includes('HOD');
      } catch { doerIsAdmin = false; }
    }
    const resolvedApproval = (doerIsAdmin && body.approval==='Approval Required') ? 'Approved' : (body.approval||'No Approval');

    if (!USE_DB) {
      const store = await readStore();
      const delegations = store.delegations||[];
      const doerUser = (store.users||[]).find(u=>u.id===body.doerId);
      const doerName = doerUser?.name||body.doerName||body.doer||'';
      const lastNum = delegations.reduce((max,d)=>{ const n=parseInt((d.id||'').replace(/[^0-9]/g,''))||0; return n>max?n:max; },0);
      const id = 'DEL'+(lastNum+1).toString().padStart(3,'0');
      const newDel = { id, description:body.description, doerId:body.doerId, doer:doerName, delegatedBy:body.delegatedBy, dueDate:normDate(body.dueDate)||body.dueDate, client:body.client||'', status:'pending', type:'delegation', priority:body.priority||'Low', approval:resolvedApproval, url:body.url||'', remarks:body.remarks||'', createdAt:new Date().toISOString() };
      delegations.push(newDel);
      store.delegations = delegations;
      await writeStore(store);
      const doerEmail = doerUser?.email || '';
      sendDelegationEmail({ toEmail:doerEmail, toName:doerName, description:body.description, dueDate:normDate(body.dueDate)||body.dueDate, priority:body.priority||'Low', delegatedByName:req.session?.user?.name, url:body.url, remarks:body.remarks });
      return res.status(201).json(newDel);
    }

    await ensureSchema();

    if (Array.isArray(body.bulk)) {
      let inserted=0; const errors=[];
      for (const [i, row] of body.bulk.entries()) {
        const email = (row.doer_email||row.doerEmail||'').trim().toLowerCase();
        const dueDate = normDate(row.due_date||row.dueDate);
        const desc = (row.description||'').trim();
        if (!email||!dueDate||!desc) { errors.push(`Row ${i+1}: missing fields`); continue; }
        const users = await q('SELECT id, name FROM users WHERE LOWER(email) = $1', [email]);
        if (!users.length) { errors.push(`Row ${i+1}: no user ${email}`); continue; }
        await insertDelegation({ description:desc, doerId:users[0].id, doerName:users[0].name, delegatedBy:body.delegatedBy, dueDate, priority:row.priority, approval:resolvedApproval, url:row.url, remarks:row.remarks });
        inserted++;
      }
      return res.status(201).json({ success:true, inserted, errors });
    }

    if (!body.description||!body.doerId||!body.dueDate) return res.status(400).json({ error:'description, doerId, dueDate required' });
    const users = await q('SELECT * FROM users WHERE id = $1', [body.doerId]);
    if (!users.length) return res.status(400).json({ error:'Selected doer no longer exists — please refresh and pick them again' });
    const row = await insertDelegation({ description:body.description, doerId:body.doerId, doerName:users[0]?.name, delegatedBy:body.delegatedBy, dueDate:normDate(body.dueDate)||body.dueDate, client:body.client, priority:body.priority, approval:resolvedApproval, url:body.url, remarks:body.remarks });
    sendDelegationEmail({ toEmail:users[0]?.email, toName:users[0]?.name, description:body.description, dueDate:normDate(body.dueDate)||body.dueDate, priority:body.priority||'Low', delegatedByName:req.session?.user?.name, url:body.url, remarks:body.remarks });
    return res.status(201).json(row);
  } catch (err) { console.error(err); return res.status(500).json({ error:err.message }); }
});

app.patch('/api/delegations', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!USE_DB) {
      const store = await readStore();
      if (body.action==='transfer') {
        const { fromDoer, toDoer, toDoerId, taskIds } = body;
        if (!fromDoer||!toDoer) return res.status(400).json({ error:'fromDoer and toDoer required' });
        const transferredBy = req.session?.user?.name||null;
        const idSet = taskIds?.length ? new Set(taskIds) : null;
        store.delegations = (store.delegations||[]).map(d => {
          const match = idSet ? idSet.has(d.id) : (d.doer===fromDoer&&d.status!=='done');
          return match&&d.status!=='done' ? {...d, doer:toDoer, doerId:toDoerId||d.doerId, transferredBy, transferredFrom:d.doer} : d;
        });
        await writeStore(store);
        return res.json({ success:true });
      }
      const del = (store.delegations||[]).find(d=>d.id===body.id);
      if (!del) return res.status(404).json({ error:'Not found' });
      let newStatus = body.status;
      if (newStatus) del.status = newStatus;
      if (newStatus==='done') del.completedAt = new Date().toISOString();
      else if (newStatus) del.completedAt = null;
      if (body.dueDate) del.dueDate=body.dueDate;
      if (body.remarks!==undefined) del.remarks=body.remarks;
      if (body.approval!==undefined) del.approval=body.approval;
      await writeStore(store);
      return res.json(del);
    }

    await ensureSchema();
    if (body.action==='transfer') {
      const { fromDoer, toDoer, toDoerId, taskIds } = body;
      if (!fromDoer||!toDoer) return res.status(400).json({ error:'fromDoer and toDoer required' });
      const transferredBy = req.session?.user?.name||null;
      if (taskIds?.length) {
        const placeholders = taskIds.map((_,i)=>'$'+(i+4)).join(',');
        await pool.query(`UPDATE delegations SET transferred_from=doer, transferred_by=$1, doer=$2, doer_id=$3 WHERE id IN (${placeholders}) AND BINARY status != 'done'`, [transferredBy,toDoer,toDoerId||null,...taskIds]);
      } else {
        await pool.query(`UPDATE delegations SET transferred_from=doer, transferred_by=$1, doer=$2, doer_id=$3 WHERE doer=$4 AND BINARY status!='done'`, [transferredBy,toDoer,toDoerId||null,fromDoer]);
      }
      return res.json({ success:true });
    }

    if (!body.id) return res.status(400).json({ error:'id required' });
    const status = body.status ?? null;
    // COALESCE can't express "clear this field" (a null param means "don't touch"),
    // so reopening (status set to anything other than 'done') needs its own branch.
    const completedAtSql = status === 'done' ? 'NOW()' : status ? 'NULL' : 'completed_at';
    await pool.query(
      `UPDATE delegations SET status=COALESCE($1,status), description=COALESCE($2,description), due_date=COALESCE($3,due_date), client=COALESCE($4,client), priority=COALESCE($5,priority), approval=COALESCE($6,approval), url=COALESCE($7,url), remarks=COALESCE($8,remarks), completed_at=${completedAtSql} WHERE id=$9`,
      [status, body.description??null, body.dueDate??null, body.client??null, body.priority??null, body.approval??null, body.url??null, body.remarks??null, body.id]
    );
    const result = await q('SELECT * FROM delegations WHERE id = $1', [body.id]);
    if (!result.length) return res.status(404).json({ error:'Not found' });
    // Fire-and-forget — an unreachable/slow SMTP server must never delay the
    // response to whoever is marking the task done/shifted.
    if (status === 'done')   sendDelegationDoneEmail(result[0]).catch(() => {});
    if (status === 'revise') sendDelegationShiftedEmail(result[0]).catch(() => {});
    return res.json(result[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error:err.message }); }
});

app.delete('/api/delegations', requireAuth, async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error:'id required' });
    if (!USE_DB) {
      const store = await readStore();
      store.delegations = (store.delegations||[]).filter(d=>d.id!==id);
      await writeStore(store);
      return res.json({ success:true });
    }
    await ensureSchema();
    await pool.query('DELETE FROM delegations WHERE id = $1', [id]);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Help Tickets ─────────────────────────────────────────────────────────────
app.get('/api/help-tickets', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const user = req.session.user;
    const isAdmin = (user.roles||[]).includes('Admin') || (user.roles||[]).includes('HOD');
    const rows = isAdmin
      ? await q('SELECT * FROM help_tickets ORDER BY created_at DESC', [])
      : await q('SELECT * FROM help_tickets WHERE submitted_by_id=$1 ORDER BY created_at DESC', [user.id]);
    return res.json(rows);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.post('/api/help-tickets', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { subject, description, priority, name, date, filedBy } = req.body;
    if (!subject) return res.status(400).json({ error: 'Subject required' });
    const user = req.session.user;
    const id = 'HT' + Date.now().toString(36).toUpperCase();
    const displayName = name || user.name;
    const filer = filedBy || user.name;
    await pool.query(
      'INSERT INTO help_tickets (id,subject,description,priority,status,submitted_by,submitted_by_id,ticket_date,name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, subject, description||'', priority||'Medium', 'open', filer, user.id, date||null, displayName]
    );
    return res.status(201).json({ id });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.patch('/api/help-tickets', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { id, status, transferred_to } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (transferred_to !== undefined) {
      await pool.query('UPDATE help_tickets SET transferred_to=$1 WHERE id=$2', [transferred_to||null, id]);
    } else {
      await pool.query('UPDATE help_tickets SET status=COALESCE($1,status) WHERE id=$2', [status??null, id]);
    }
    return res.json({ success: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── Announcements ─────────────────────────────────────────────────────────────
app.get('/api/announcements', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const rows = await q('SELECT * FROM announcements ORDER BY created_at DESC', []);
    return res.json(rows);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.post('/api/announcements', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { title, message } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const user = req.session.user;
    const roles = user.roles || [];
    const isAdmin = roles.includes('Admin') || roles.includes('HOD');
    if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
    const id = 'AN' + Date.now().toString(36).toUpperCase();
    await pool.query(
      'INSERT INTO announcements (id,title,message,posted_by) VALUES ($1,$2,$3,$4)',
      [id, title, message||'', user.name]
    );
    return res.status(201).json({ id });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.delete('/api/announcements', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    await pool.query('DELETE FROM announcements WHERE id=$1', [id]);
    return res.json({ success: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── Vendor Public Form (no auth) ──────────────────────────────────────────────
app.get('/vendor-form', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'public', 'vendor-form.html'));
});

app.post('/api/vendor-public', async (req, res) => {
  try {
    await ensureSchema();
    const { business_name, contact_person, phone, email, gst_no, address, products, notes } = req.body;
    if (!business_name) return res.status(400).json({ error: 'Business name required' });
    const id = 'VS' + Date.now().toString(36).toUpperCase();
    await pool.query(
      'INSERT INTO vendor_submissions (id,business_name,contact_person,phone,email,gst_no,address,products,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, business_name, contact_person||'', phone||'', email||'', gst_no||'', address||'', products||'', notes||'']
    );
    return res.status(201).json({ success: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.get('/api/vendor-submissions', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const rows = await q('SELECT * FROM vendor_submissions ORDER BY created_at DESC', []);
    return res.json(rows);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── PR Form (digitized purchase-requisition intake form) ─────────────────────
// "RM_1_res" is the native Google Form response tab the store team's original
// PR Form (the paper-to-Google-Form workflow this app's PR Form tab digitizes)
// already appended to — same spreadsheet, same 20-column shape. Keep writing
// there too so the app's submissions land in that one continuous history
// instead of starting a second, disconnected log.
const PR_FORM_RESPONSES_SHEET_ID = '1CHOh_MRtlI6Bpw1ztmKthZ7vkgVVNn9xdV48DGU87kY';
const PR_FORM_RESPONSES_TAB = 'RM_1_res';

app.post('/api/pr-requisitions', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const {
      pr_no, filled_by, vendors, vendor_other, department, department_other,
      accessory_product, brazing_product, cnc_product, consumable_product,
      electric_product, packing_product, pressing_product, washing_product,
      welding_product, new_product, current_stock, quantity_required, previous_rate,
    } = req.body;
    if (!pr_no || !filled_by) return res.status(400).json({ error: 'PR No. and Filled By are required' });
    if (!(vendors && vendors.length) && !vendor_other) return res.status(400).json({ error: 'Select a vendor or enter a new one' });
    if (!(department && department.length) && !department_other) return res.status(400).json({ error: 'Select a department or enter a new one' });
    if (!current_stock || !quantity_required || !previous_rate) return res.status(400).json({ error: 'Current Stock, Quantity Required and Previous Rate are required' });
    const id = 'PR' + Date.now().toString(36).toUpperCase();
    const sessUser = req.session?.user;
    const deptOther = await canonicalDept(department_other);
    const joined = {
      vendors: Array.isArray(vendors) ? vendors.join(', ') : (vendors || ''),
      // Canonicalised rather than plain-joined: the multi-select can carry a
      // department typed into an older form in a different case (see canonicalDept).
      department: await canonicalDeptList(department),
      accessory_product: Array.isArray(accessory_product) ? accessory_product.join(', ') : (accessory_product || ''),
      brazing_product: Array.isArray(brazing_product) ? brazing_product.join(', ') : (brazing_product || ''),
      consumable_product: Array.isArray(consumable_product) ? consumable_product.join(', ') : (consumable_product || ''),
      electric_product: Array.isArray(electric_product) ? electric_product.join(', ') : (electric_product || ''),
      packing_product: Array.isArray(packing_product) ? packing_product.join(', ') : (packing_product || ''),
      pressing_product: Array.isArray(pressing_product) ? pressing_product.join(', ') : (pressing_product || ''),
      washing_product: Array.isArray(washing_product) ? washing_product.join(', ') : (washing_product || ''),
      welding_product: Array.isArray(welding_product) ? welding_product.join(', ') : (welding_product || ''),
    };
    await pool.query(
      `INSERT INTO pr_requisitions
        (id,pr_no,filled_by,vendors,vendor_other,department,department_other,
         accessory_product,brazing_product,cnc_product,consumable_product,electric_product,
         packing_product,pressing_product,washing_product,welding_product,new_product,
         current_stock,quantity_required,previous_rate,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        id, pr_no, filled_by,
        joined.vendors, vendor_other || '',
        joined.department, deptOther,
        joined.accessory_product, joined.brazing_product, cnc_product || '', joined.consumable_product, joined.electric_product,
        joined.packing_product, joined.pressing_product, joined.washing_product, joined.welding_product,
        new_product || '',
        current_stock, quantity_required, previous_rate,
        sessUser?.name || '',
      ]
    );
    try {
      await appendLogRow(PR_FORM_RESPONSES_SHEET_ID, PR_FORM_RESPONSES_TAB, [
        _timestampForSheet(), pr_no, filled_by,
        joined.vendors, vendor_other || '',
        joined.department, deptOther,
        joined.accessory_product, joined.brazing_product, cnc_product || '', joined.consumable_product, joined.electric_product,
        joined.packing_product, joined.pressing_product, joined.washing_product, joined.welding_product,
        new_product || '',
        current_stock, quantity_required, previous_rate,
      ]);
    } catch (e) { console.error('[pr-form] RM_1_res sync failed:', e.message); }
    return res.status(201).json({ success: true, id });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── Masters (Checklist Masters) ───────────────────────────────────────────────
app.get('/api/masters', requireAuth, async (req, res) => {
  const sessUser = req.session?.user;
  const isAdmin = isAdminUser(sessUser);
  const isHOD = isHODUser(sessUser);
  const userId = sessUser?.id;
  const userName = (sessUser?.name || '').trim().toLowerCase();
  if (!USE_DB) {
    const store = await readStore();
    let rows = store.masters||[];
    if (isHOD) {
      // Department looked up fresh off store.users by id — see /api/dashboard's
      // comment on why a cached session department string isn't trustworthy.
      const myFreshDept = (store.users || []).find(u => u.id === userId)?.department || '';
      const teamNames = new Set((store.users || []).filter(u => normDept(u.department) === normDept(myFreshDept)).map(u => (u.name || '').trim().toLowerCase()));
      rows = rows.filter(m => teamNames.has((m.assignedTo||'').trim().toLowerCase()) || (m.assignedTo||'').trim().toLowerCase() === userName);
    } else if (!isAdmin) {
      rows = rows.filter(m => (m.assignedTo||'').trim().toLowerCase() === userName);
    }
    return res.json(rows);
  }
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM masters ORDER BY created_at DESC');
  let mapped = rows.map(r => ({ id:r.id, task:r.task, assignedTo:r.assigned_to||'', department:r.department||'', frequency:r.frequency, startDate:toDateStr(r.start_date), endDate:toDateStr(r.end_date), remarks:r.remarks||'', createdAt:toIso(r.created_at) }));
  if (isHOD) {
    // Department subquery keys off the HOD's own id, never a cached session string.
    const teamRows = await q('SELECT LOWER(TRIM(name)) AS n FROM users WHERE LOWER(TRIM(department))=(SELECT LOWER(TRIM(department)) FROM users WHERE id=$1)', [userId]);
    const teamNames = new Set(teamRows.map(r => r.n));
    mapped = mapped.filter(m => teamNames.has(m.assignedTo.trim().toLowerCase()) || m.assignedTo.trim().toLowerCase() === userName);
  } else if (!isAdmin) {
    mapped = mapped.filter(m => m.assignedTo.trim().toLowerCase() === userName);
  }
  return res.json(mapped);
});

// A checklist master row is one dated occurrence, not a recurring template — so creating
// one with a frequency + start date (+ optional end date) pre-generates the whole series
// as separate rows (each its own id), matching the "Daily (365 tasks/year)" etc. labels
// the Add Checklist form has always shown. Without an end date the series defaults to one
// year forward, which is where those per-year counts come from.
function addChecklistInterval(dateStr, freq) {
  const d = new Date(dateStr + 'T00:00:00Z');
  switch (String(freq || 'daily').toLowerCase()) {
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'alternative_week': case 'alternate_week': d.setUTCDate(d.getUTCDate() + 14); break;
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'yearly': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    case 'daily': default: d.setUTCDate(d.getUTCDate() + 1); break;
  }
  return d.toISOString().slice(0, 10);
}
function defaultChecklistSeriesEnd(startDate) {
  const d = new Date(startDate + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const CHECKLIST_MAX_OCCURRENCES = 400; // safety cap, well above a 365-day daily series
function generateChecklistDates(startDate, endDate, freq) {
  const end = endDate || defaultChecklistSeriesEnd(startDate);
  const dates = [];
  let cur = startDate;
  while (cur <= end && dates.length < CHECKLIST_MAX_OCCURRENCES) {
    dates.push(cur);
    cur = addChecklistInterval(cur, freq);
  }
  return dates;
}

// One-time maintenance action: checklist masters created before recurring generation
// existed are each a single dated row with no series behind them. This backfills their
// future occurrences (from the interval after their own start date, through their stored
// end date or one year forward) so they behave like newly-created recurring tasks. Safe to
// call more than once — it skips any (task, assignee, date) combination that already exists.
app.post('/api/masters/backfill-recurring', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const existing = await q('SELECT id, task, assigned_to, frequency, start_date, end_date, remarks, department FROM masters WHERE start_date IS NOT NULL');
    const keyOf = (task, assignedTo, date) => task + '||' + assignedTo + '||' + date;
    const seen = new Set(existing.map(m => keyOf(m.task, m.assigned_to, toDateStr(m.start_date))));
    const base = Date.now().toString(36).toUpperCase();
    let created = 0, seriesCount = 0;
    for (const m of existing) {
      const startDate = toDateStr(m.start_date);
      const endDate = toDateStr(m.end_date) || defaultChecklistSeriesEnd(startDate);
      const dates = generateChecklistDates(startDate, endDate, m.frequency).slice(1);
      let any = false;
      for (const date of dates) {
        const key = keyOf(m.task, m.assigned_to, date);
        if (seen.has(key)) continue;
        seen.add(key);
        const id = 'CHK' + base + created.toString(36).padStart(4, '0').toUpperCase();
        await pool.query('INSERT INTO masters (id,task,assigned_to,frequency,start_date,end_date,remarks,department,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())',
          [id, m.task, m.assigned_to, m.frequency, date, null, m.remarks || '', m.department || '']);
        created++; any = true;
      }
      if (any) seriesCount++;
    }
    return res.json({ success:true, created, seriesCount, mastersScanned: existing.length });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post('/api/masters', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!body.task?.trim()) return res.status(400).json({ error:'Task required' });
    const task = body.task.trim();
    const assignedTo = (body.assignedTo||'').trim();
    const frequency = body.frequency || 'Daily';
    const remarks = body.remarks || '';
    const department = await canonicalDept(body.department);
    const startDate = body.startDate || null;
    const dates = startDate ? generateChecklistDates(startDate, body.endDate || null, frequency) : [null];
    const base = Date.now().toString(36).toUpperCase();
    const ids = dates.map((_, i) => 'CHK' + base + i.toString(36).padStart(3, '0').toUpperCase());

    if (!USE_DB) {
      const store = await readStore();
      const masters = store.masters||[];
      dates.forEach((d, i) => {
        masters.push({ id: ids[i], task, assignedTo, frequency, startDate: d, endDate: null, remarks, department, createdAt: new Date().toISOString() });
      });
      store.masters = masters;
      await writeStore(store);
      return res.status(201).json({ success:true, id: ids[0], count: ids.length });
    }
    await ensureSchema();
    for (let i = 0; i < dates.length; i++) {
      await pool.query('INSERT INTO masters (id,task,assigned_to,frequency,start_date,end_date,remarks,department,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())', [ids[i], task, assignedTo, frequency, dates[i], null, remarks, department]);
    }
    return res.status(201).json({ success:true, id: ids[0], count: ids.length });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.patch('/api/masters', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!body.id) return res.status(400).json({ error:'id required' });
    if (!USE_DB) {
      const store = await readStore();
      const m = (store.masters||[]).find(x=>x.id===body.id);
      if (!m) return res.status(404).json({ error:'Not found' });
      if (body.task) m.task=body.task;
      if (body.assignedTo) m.assignedTo=body.assignedTo.trim();
      if (body.frequency) m.frequency=body.frequency;
      if (body.startDate !== undefined) m.startDate=body.startDate;
      if (body.endDate !== undefined) m.endDate=body.endDate;
      if (body.remarks !== undefined) m.remarks=body.remarks;
      if (body.department !== undefined) m.department=await canonicalDept(body.department);
      await writeStore(store);
      return res.json({ success:true });
    }
    await ensureSchema();
    const before = await q('SELECT assigned_to, task FROM masters WHERE id=$1', [body.id]);
    const prevAssignee = before[0]?.assigned_to || '';
    const assignedTo = body.assignedTo !== undefined ? body.assignedTo.trim() : undefined;
    const dept = body.department == null ? null : await canonicalDept(body.department);
    await pool.query('UPDATE masters SET task=COALESCE($1,task), assigned_to=COALESCE($2,assigned_to), frequency=COALESCE($3,frequency), start_date=COALESCE($4,start_date), end_date=COALESCE($5,end_date), remarks=COALESCE($6,remarks), department=COALESCE($7,department) WHERE id=$8', [body.task??null,assignedTo??null,body.frequency??null,body.startDate??null,body.endDate??null,body.remarks??null,dept,body.id]);
    // Fire-and-forget — bulk Transfer PATCHes many checklist rows in a row; an
    // awaited SMTP call here would serialize (and could hang) the whole batch.
    if (assignedTo && assignedTo !== prevAssignee) {
      sendChecklistTransferEmail({ assignedTo, taskDesc: body.task || before[0]?.task || '', prevAssignee }).catch(() => {});
    }
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.delete('/api/masters', requireAuth, async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error:'id required' });
    if (!USE_DB) {
      const store = await readStore();
      store.masters = (store.masters||[]).filter(m=>m.id!==id);
      await writeStore(store);
      return res.json({ success:true });
    }
    await ensureSchema();
    await pool.query('DELETE FROM masters WHERE id = $1', [id]);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// Delete ALL checklist tasks in one go (Admin/HOD only) — leaves delegations + completion history intact
app.delete('/api/masters/all', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!USE_DB) {
      const store = await readStore();
      store.masters = [];
      await writeStore(store);
      return res.json({ success:true });
    }
    await ensureSchema();
    const backupId = await createBackup('Before Delete All Checklist Tasks').catch(()=>null);
    await pool.query('DELETE FROM masters');
    return res.json({ success:true, backupId });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// Count checklist tasks whose due date (start_date) matches — used to preview before bulk delete
app.get('/api/masters/count-by-date', requireAuth, requireAdmin, async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error:'date required' });
    if (!USE_DB) {
      const store = await readStore();
      const count = (store.masters||[]).filter(m => m.startDate === date).length;
      return res.json({ count });
    }
    await ensureSchema();
    const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM masters WHERE start_date = $1', [date]);
    return res.json({ count: Number(rows[0].cnt) });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// Delete all checklist tasks whose due date (start_date) matches (Admin/HOD only)
app.delete('/api/masters/by-date', requireAuth, requireAdmin, async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error:'date required' });
    if (!USE_DB) {
      const store = await readStore();
      const before = (store.masters||[]).length;
      store.masters = (store.masters||[]).filter(m => m.startDate !== date);
      await writeStore(store);
      return res.json({ success:true, deleted: before - store.masters.length });
    }
    await ensureSchema();
    const backupId = await createBackup(`Before Delete Checklist Tasks due ${date}`).catch(()=>null);
    const result = await pool.query('DELETE FROM masters WHERE start_date = $1', [date]);
    return res.json({ success:true, deleted: result.rowCount, backupId });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Checklist Completions ─────────────────────────────────────────────────────
app.post('/api/checklist-completions', requireAuth, async (req, res) => {
  try {
    const { masterId, doer } = req.body;
    if (!masterId) return res.status(400).json({ error:'masterId required' });
    if (!USE_DB) return res.json({ success:true });
    await ensureSchema();
    const { rows:c } = await pool.query('SELECT COUNT(*) AS cnt FROM checklist_completions');
    const id = 'CC'+(Number(c[0].cnt)+1).toString().padStart(3,'0');
    await pool.query('INSERT INTO checklist_completions (id,master_id,doer,completed_at,date) VALUES ($1,$2,$3,NOW(),CURRENT_DATE)', [id,masterId,doer||'']);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.get('/api/checklist-completions', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    // Each masters row is a single dated occurrence (recurring series are pre-generated as
    // separate rows), so callers (All Tasks) use this to know which occurrences have EVER
    // been completed, not just today — a completion doesn't expire when the day changes.
    // An explicit ?date= still scopes to one day for reporting-style callers.
    const dateFilter = req.query.date || null;
    if (!isAdminUser(req.session?.user)) {
      let sql = `SELECT cc.* FROM checklist_completions cc JOIN masters m ON m.id = cc.master_id WHERE LOWER(TRIM(m.assigned_to)) = LOWER(TRIM($1))`;
      const params = [req.session?.user?.name || ''];
      if (dateFilter) { sql += ' AND cc.date = $2'; params.push(dateFilter); }
      sql += ' ORDER BY cc.completed_at DESC';
      const { rows } = await pool.query(sql, params);
      return res.json(rows);
    }
    let sql = 'SELECT * FROM checklist_completions';
    const params = [];
    if (dateFilter) { sql += ' WHERE date = $1'; params.push(dateFilter); }
    sql += ' ORDER BY completed_at DESC';
    const { rows } = await pool.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('[api/checklist-completions]', err);
    return res.status(500).json({ error: err.message });
  }
});

// Reopen a checklist task: undo its completion so it shows as pending again.
app.delete('/api/checklist-completions', requireAuth, async (req, res) => {
  try {
    const masterId = req.query.masterId;
    if (!masterId) return res.status(400).json({ error:'masterId required' });
    if (!USE_DB) return res.json({ success:true });
    await ensureSchema();
    await pool.query('DELETE FROM checklist_completions WHERE master_id=$1', [masterId]);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Departments master ────────────────────────────────────────────────────────
// One list, one endpoint, every Department dropdown in the app. Adding is open
// to any signed-in user because the "+ Add new department" option lives inside
// the forms themselves (Inward/Outward, PR, PO, Daily Task) — the store hand who
// hits a missing department mid-entry has to be able to add it without an Admin.
// Deleting is Admin/HOD only, and only ever removes the name from future
// dropdowns: departments are stored on past records as plain text, so nothing
// already saved changes.

app.get('/api/departments', requireAuth, async (req, res) => {
  try { return res.json(await listDepartments()); }
  catch (e) { return res.status(500).json({ error: e.message }); }
});

app.post('/api/departments', requireAuth, async (req, res) => {
  try {
    // Title-cased on the way in so the list itself never mixes "PACKING DEPT."
    // with "Packing Dept." — see titleCaseDept.
    const name = titleCaseDept(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Department name is required' });
    if (name.length > 128) return res.status(400).json({ error: 'Department name is too long (max 128 characters)' });

    const existing = await listDepartments();
    // Case-insensitive so "Packing Dept." can't come back a second time as
    // "packing dept." and split the same shop floor across two dropdown entries.
    const dupe = existing.find(d => d.toLowerCase() === name.toLowerCase());
    if (dupe) return res.status(409).json({ error: `"${dupe}" already exists in the department list` });

    if (!USE_DB) {
      const store = await readStore();
      store.departments = (Array.isArray(store.departments) && store.departments.length)
        ? store.departments
        : FACTORY_DEPARTMENTS.slice();
      store.departments.push(name);
      await writeStore(store);
      return res.json({ success: true, name, departments: store.departments });
    }

    await ensureSchema();
    const idRows = await q("SELECT MAX(CAST(SUBSTRING(id,4) AS UNSIGNED)) AS maxnum FROM departments WHERE id REGEXP '^DEP[0-9]+'");
    const id = 'DEP' + ((parseInt(idRows[0]?.maxnum) || 0) + 1).toString().padStart(3, '0');
    const ordRows = await q('SELECT MAX(sort_order) AS maxord FROM departments');
    const sortOrder = (parseInt(ordRows[0]?.maxord) || 0) + 10;
    await pool.query('INSERT INTO departments (id,name,sort_order) VALUES ($1,$2,$3)', [id, name, sortOrder]);
    return res.json({ success: true, name, departments: await listDepartments() });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

app.delete('/api/departments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Department name is required' });

    if (!USE_DB) {
      const store = await readStore();
      const list = (Array.isArray(store.departments) && store.departments.length)
        ? store.departments
        : FACTORY_DEPARTMENTS.slice();
      store.departments = list.filter(d => d.toLowerCase() !== name.toLowerCase());
      await writeStore(store);
      return res.json({ success: true, departments: store.departments });
    }

    await ensureSchema();
    await pool.query('DELETE FROM departments WHERE LOWER(name) = LOWER($1)', [name]);
    return res.json({ success: true, departments: await listDepartments() });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── Users ─────────────────────────────────────────────────────────────────────
app.get('/api/users', requireAuth, async (req, res) => {
  if (!USE_DB) {
    const store = await readStore();
    return res.json((store.users||[]).map(({ password_hash, ...u }) => u));
  }
  await ensureSchema();
  const rows = await q('SELECT * FROM users ORDER BY id');
  return res.json(rows.map(({ password_hash, ...u }) => ({ ...u, permissions: parsePermissions(u.permissions) })));
});

// The DB stores permissions as a JSON TEXT column — routes that SELECT * and forward the
// row straight to the client must parse it, or the frontend receives a raw string, "perm.pages"
// is always undefined, and every page-access checkbox silently falls back to its unrestricted
// default no matter what was actually saved.
function parsePermissions(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

// Default page access for newly created (non-Admin/HOD) users — must match keys in
// ALL_PAGES (public/js/pages/users.js). Everything else stays hidden until an Admin
// grants it from the Access tab.
const DEFAULT_USER_PAGES = ['all-tasks', 'approvals', 'announcements', 'help-ticket', 'mis', 'profile'];
function defaultPermissionsFor(roles) {
  const list = Array.isArray(roles) ? roles : String(roles || '').split(',').map(r => r.trim());
  if (list.includes('Admin') || list.includes('HOD')) return null;
  return { pages: DEFAULT_USER_PAGES, features: {} };
}

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const body = req.body;
  if (Array.isArray(body.bulk)) {
    try {
      let inserted=0; const errors=[];
      if (!USE_DB) {
        const store = await readStore();
        store.users = store.users || [];
        for (const [i,row] of body.bulk.entries()) {
          const name=(row.name||'').trim(); const email=(row.email||'').trim().toLowerCase();
          if (!name||!email) { errors.push(`Row ${i+1}: name/email missing`); continue; }
          if (store.users.find(u=>(u.email||'').toLowerCase()===email && (u.name||'').trim().toLowerCase()===name.toLowerCase())) { errors.push(`Row ${i+1}: ${name} <${email}> already exists`); continue; }
          const lastNum = store.users.reduce((max,u)=>{ const n=parseInt((u.id||'').replace(/[^0-9]/g,''))||0; return n>max?n:max; },0);
          const id = 'U'+(lastNum+1).toString().padStart(3,'0');
          const roles = parseRoles(row.role||'', row.user_role||'');
          const hash = row.password ? await bcrypt.hash(row.password, 10) : null;
          store.users.push({ id, name, email, phone:row.phone||'', department: await canonicalDept(row.department), roles, active:true, password_hash:hash, permissions: defaultPermissionsFor(roles), createdAt:new Date().toISOString() });
          inserted++;
        }
        await writeStore(store);
        return res.status(201).json({ success:true, inserted, errors });
      }
      await ensureSchema();
      const maxRow = await q("SELECT MAX(CAST(SUBSTRING(id,2) AS UNSIGNED)) AS maxnum FROM users WHERE id REGEXP '^U[0-9]+'");
      let lastNum = (maxRow.length && maxRow[0].maxnum) ? parseInt(maxRow[0].maxnum)||0 : 0;
      for (const [i,row] of body.bulk.entries()) {
        const name=(row.name||'').trim(); const email=(row.email||'').trim().toLowerCase();
        if (!name||!email) { errors.push(`Row ${i+1}: name/email missing`); continue; }
        const ex = await q('SELECT id FROM users WHERE LOWER(email) = $1 AND LOWER(name) = $2', [email, name.toLowerCase()]);
        if (ex.length) { errors.push(`Row ${i+1}: ${name} <${email}> already exists`); continue; }
        lastNum++;
        const id = 'U'+lastNum.toString().padStart(3,'0');
        const roles = parseRoles(row.role||'', row.user_role||'');
        const hash = row.password ? await bcrypt.hash(row.password, 10) : null;
        const perms = defaultPermissionsFor(roles);
        try {
          await pool.query('INSERT INTO users (id,name,email,phone,department,roles,active,password_hash,permissions,created_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,NOW())', [id,name,email,row.phone||'',await canonicalDept(row.department),roles.join(','),hash,perms?JSON.stringify(perms):null]);
          inserted++;
        } catch(ie) {
          if (ie.code==='ER_DUP_ENTRY'||ie.code==='23505') { errors.push(`Row ${i+1}: ${email} already exists (id conflict)`); lastNum--; }
          else throw ie;
        }
      }
      syncUsers_gs().catch(()=>{});
      return res.status(201).json({ success:true, inserted, errors });
    } catch(e) {
      console.error('POST /api/users bulk error:', e.message);
      return res.status(500).json({ error: e.message || 'Bulk insert failed' });
    }
  }

  if (!body.name||!body.email) return res.status(400).json({ error:'Name and email required' });

  if (!USE_DB) {
    const store = await readStore();
    const users = store.users||[];
    if (users.find(u=>(u.email||'').toLowerCase()===body.email.trim().toLowerCase() && (u.name||'').trim().toLowerCase()===body.name.trim().toLowerCase())) return res.status(400).json({ error:'A user with this name and email already exists' });
    const lastNum = users.reduce((max,u)=>{ const n=parseInt((u.id||'').replace('U',''))||0; return n>max?n:max; },0);
    const id = 'U'+(lastNum+1).toString().padStart(3,'0');
    const roles = body.roles?.length ? body.roles : ['User'];
    const newUser = { id, name:body.name.trim(), email:body.email.trim(), phone:body.phone||'', department: await canonicalDept(body.department), branch:body.branch||'', roles, active:true, permissions: defaultPermissionsFor(roles), createdAt:new Date().toISOString() };
    users.push(newUser); store.users=users;
    await writeStore(store);
    return res.status(201).json(newUser);
  }

  try {
    await ensureSchema();
    const ex = await q('SELECT id FROM users WHERE LOWER(email) = $1 AND LOWER(name) = $2', [body.email.trim().toLowerCase(), body.name.trim().toLowerCase()]);
    if (ex.length) return res.status(400).json({ error: 'A user with this name and email already exists' });
    const last = await q('SELECT id FROM users ORDER BY id DESC LIMIT 1');
    const lastNum = last.length ? (parseInt((last[0].id||'U000').replace(/[^0-9]/g,''))||0) : 0;
    const id = 'U'+(lastNum+1).toString().padStart(3,'0');
    const roles = body.roles?.length ? body.roles : ['User'];
    const hash = body.password ? await bcrypt.hash(body.password, 10) : null;
    const perms = defaultPermissionsFor(roles);
    await pool.query('INSERT INTO users (id,name,email,phone,department,branch,roles,active,password_hash,permissions,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,NOW())', [id,body.name.trim(),body.email.trim().toLowerCase(),body.phone||'',await canonicalDept(body.department),body.branch||'',roles.join(','),hash,perms?JSON.stringify(perms):null]);
    if (body.picture) {
      try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT DEFAULT NULL'); } catch {}
      await pool.query('UPDATE users SET picture=$1 WHERE id=$2', [body.picture,id]);
      safeUploadUserPhotoToDrive(body.pictureOriginal || body.picture, { userId: id, userName: body.name.trim() });
    }
    const result = await q('SELECT * FROM users WHERE id = $1', [id]);
    syncUsers_gs().catch(()=>{});
    const { password_hash, ...created } = result[0];
    return res.status(201).json({ ...created, permissions: parsePermissions(created.permissions) });
  } catch(e) {
    console.error('POST /api/users error:', e.message);
    return res.status(500).json({ error: e.message || 'Failed to create user' });
  }
});

app.patch('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body;
    if (!body.id) return res.status(400).json({ error:'id required' });
    if (!USE_DB) {
      const store = await readStore();
      const user = (store.users||[]).find(u=>u.id===body.id);
      if (!user) return res.status(404).json({ error:'Not found' });
      if (body.name!==undefined) user.name=body.name;
      if (body.email!==undefined) user.email=body.email;
      if (body.phone!==undefined) user.phone=body.phone;
      if (body.department!==undefined) user.department=await canonicalDept(body.department);
      if (body.branch!==undefined) user.branch=body.branch;
      if (body.roles!==undefined) user.roles=Array.isArray(body.roles)?body.roles:body.roles.split(',').map(r=>r.trim());
      if (body.active!==undefined) user.active=body.active;
      if (body.permissions!==undefined) user.permissions=body.permissions;
      await writeStore(store);
      return res.json(user);
    }
    await ensureSchema();
    const roles = body.roles ? (Array.isArray(body.roles)?body.roles.join(','):body.roles) : null;
    // Left null when the form didn't send the field at all (COALESCE keeps what is
    // stored); an empty string still clears it, as before.
    const dept = body.department == null ? null : await canonicalDept(body.department);
    await pool.query(
      `UPDATE users SET name=COALESCE($1,name), email=COALESCE($2,email), phone=COALESCE($3,phone), department=COALESCE($4,department), branch=COALESCE($5,branch), roles=COALESCE($6,roles), active=COALESCE($7,active) WHERE id=$8`,
      [body.name??null,body.email??null,body.phone??null,dept,body.branch??null,roles,body.active===undefined?null:(body.active?1:0),body.id]
    );
    if (body.picture!==undefined) {
      try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT DEFAULT NULL'); } catch {}
      await pool.query('UPDATE users SET picture=$1 WHERE id=$2', [body.picture,body.id]);
      // Only on a real upload — clearing the photo shouldn't archive anything.
      if (body.picture) safeUploadUserPhotoToDrive(body.pictureOriginal || body.picture, { userId: body.id, userName: body.name || '' });
    }
    if (body.permissions!==undefined) {
      const permStr = body.permissions === null ? null : JSON.stringify(body.permissions);
      await pool.query('UPDATE users SET permissions=$1 WHERE id=$2', [permStr, body.id]);
    }
    const result = await q('SELECT * FROM users WHERE id = $1', [body.id]);
    if (!result.length) return res.status(404).json({ error:'Not found' });
    syncUsers_gs().catch(()=>{});
    const { password_hash, ...updated } = result[0];
    return res.json({ ...updated, permissions: parsePermissions(updated.permissions) });
  } catch (err) { console.error('[PATCH /api/users]',err); return res.status(500).json({ error:err.message }); }
});

app.delete('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error:'id required' });
  if (!USE_DB) {
    const store = await readStore();
    store.users=(store.users||[]).filter(u=>u.id!==id);
    await writeStore(store);
    return res.json({ success:true });
  }
  await ensureSchema();
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  syncUsers_gs().catch(()=>{});
  return res.json({ success:true });
});

// ── Users: set-password ───────────────────────────────────────────────────────
app.post('/api/users/set-password', requireAuth, requireAdmin, async (req, res) => {
  const { userId, password } = req.body;
  if (!userId||!password||password.length<6) return res.status(400).json({ error:'userId and password (min 6 chars) required' });
  const hash = await bcrypt.hash(password, 10);
  const now = Date.now();
  if (!USE_DB) {
    const store = await readStore();
    const user = (store.users||[]).find(u=>u.id===userId);
    if (!user) return res.status(404).json({ error:'User not found' });
    user.password_hash=hash; user.forceLogoutAfter=now;
    await writeStore(store);
    return res.json({ success:true });
  }
  await ensureSchema();
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash,userId]);
  return res.json({ success:true });
});

// Super-admin only: drop every stored session belonging to a user, which signs
// them out on every device the moment their next request lands. Hiding the
// button in the UI is cosmetic — requireSuperAdmin is the actual gate.
app.post('/api/users/signout-all', requireAuth, requireSuperAdmin, async (req, res) => {
  const everyone = req.body?.all === true;
  const userId   = String(req.body?.userId || '').trim();
  if (!everyone && !userId) return res.status(400).json({ error: 'userId required' });
  if (!sessionStore) return res.status(503).json({ error: 'Sessions are not stored in the database on this deployment' });
  try {
    // Catch any session row still missing its user_id before deleting by it.
    await sessionStore.backfillUserIds().catch(() => {});
    // The bulk case deliberately spares req.sessionID: the caller stays signed
    // in on this tab, and signs themselves out from their own row if they want.
    const { rowCount } = everyone
      ? await sessionStore.destroyAllExcept(req.sessionID)
      : await sessionStore.destroyByUser(userId);
    console.log('[signout-all]', everyone ? 'EVERYONE' : userId, 'sessions dropped:', rowCount || 0,
                'by', req.session.user?.email || '');
    return res.json({ success: true, sessions: rowCount || 0 });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ── Holidays ──────────────────────────────────────────────────────────────────
app.get('/api/holidays', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { rows } = await pool.query('SELECT id, date, name, type FROM holidays ORDER BY date ASC');
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// Adding a holiday moves payroll and the muster roll for the whole company,
// so it is Admin/HOD only. The button was hidden from everyone else but the
// route never checked — hiding a button is not a permission.
app.post('/api/holidays', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    if (Array.isArray(b.bulk)) {
      let inserted=0, skipped=0;
      for (const row of b.bulk) {
        const date=normDate(row.date); const name=(row.name||'').trim();
        if (!date||!name) { skipped++; continue; }
        const { rows:c } = await pool.query('SELECT COUNT(*) AS cnt FROM holidays');
        const id = 'H'+(Number(c[0].cnt)+1).toString().padStart(3,'0');
        await pool.query('INSERT INTO holidays (id,date,name,type) VALUES ($1,$2,$3,$4)', [id,date,name,row.type||'Holiday']);
        inserted++;
      }
      return res.status(201).json({ success:true, inserted, skipped });
    }
    const date=normDate(b.date); const name=(b.name||'').trim();
    if (!date||!name) return res.status(400).json({ error:'date and name required' });
    const { rows:c } = await pool.query('SELECT COUNT(*) AS cnt FROM holidays');
    const id = 'H'+(Number(c[0].cnt)+1).toString().padStart(3,'0');
    await pool.query('INSERT INTO holidays (id,date,name,type) VALUES ($1,$2,$3,$4)', [id,date,name,b.type||'Holiday']);
    return res.status(201).json({ success:true, id });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// Same for removing one — see the note on POST above.
app.delete('/api/holidays', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error:'id required' });
    await pool.query('DELETE FROM holidays WHERE id = $1', [id]);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Leaves ────────────────────────────────────────────────────────────────────
// Leave reasons are personal — illness, bereavement, family trouble. Admins and
// HODs see everyone because approving is their job; everyone else sees their own
// rows and nothing else, whatever they ask for. This used to trust the caller:
// `?userId=` was honoured for any id, and omitting it returned the whole
// company's leave to anyone signed in. The scope is decided here now, from the
// session, so it cannot be asked around.
app.get('/api/leaves', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const cols = `id, user_id AS userId, user_name AS userName, type, leave_type AS leaveType, half_day AS halfDay,
                  total_days AS totalDays, from_date AS fromDate, to_date AS toDate, reason, status, approver,
                  created_at AS createdAt, decided_at AS decidedAt`;
    const me = req.session?.user;
    const scopedId = isAdminUser(me) ? req.query.userId : (me?.id || '-no-such-user');
    const rows = scopedId
      ? await q(`SELECT ${cols} FROM leaves WHERE user_id=$1 ORDER BY created_at DESC`, [scopedId])
      : await q(`SELECT ${cols} FROM leaves ORDER BY created_at DESC`);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.post('/api/leaves', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const body = req.body;
    if (!body.userName||!body.fromDate||!body.toDate) return res.status(400).json({ error:'userName, fromDate, toDate required' });
    const c = await q('SELECT COUNT(*) AS cnt FROM leaves');
    const id = 'LV'+(Number(c[0].cnt)+1).toString().padStart(4,'0');
    await pool.query('INSERT INTO leaves (id,user_id,user_name,type,from_date,to_date,reason,status,approver) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id,body.userId||null,body.userName,body.type||'Leave',body.fromDate,body.toDate,body.reason||'','pending',body.approver||'HOD']);
    return res.status(201).json({ success:true, id });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// Deciding a leave from the older Leave Tracker page. The status update itself
// is trivial, but approving also has to book the days against the employee's
// leave balance — and that arithmetic belongs to the HRMS, which owns the
// balances. Delegating keeps one rule: whichever screen a leave is approved on,
// the balance moves the same way. See applyLeaveDecision in backend/hrms.js.
app.patch('/api/leaves', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const body = req.body;
    if (!body.id||!body.status) return res.status(400).json({ error:'id and status required' });
    const decision = await hrms.applyLeaveDecision(body.id, body.status, req.session?.user?.name || '');
    if (!decision) return res.status(404).json({ error:'Leave request not found' });
    return res.json({ success:true, balanceAfter: decision.balanceAfter });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── HRMS routes ───────────────────────────────────────────────────────────────
// Mounted here, after the auth guards and the leave routes it extends: the HR
// module gets this file's pool, its schema bootstrap and its guards, so there is
// one database connection and one definition of "Admin" across the whole app.
// Everything it serves lives under /api/hr/. See backend/hrms.js.
// getGoogleAuth is handed over rather than letting the HR module build its own
// credentials: it is a function declaration defined further down (hoisted, and
// only called at request time), and it is the one place that knows how this
// deployment stores its private key — see the note above _normalizeGooglePrivateKey.
const hrms = mountHrms(app, {
  pool, q, ensureSchema, requireAuth, requireAdmin, requireSuperAdmin, isAdminUser, getGoogleAuth,
  // The HR module stores departments in its own tables (hr_employees, hr_payslips)
  // but must spell them the way the rest of the app does — so it shares this
  // file's canonicaliser and the departments master behind it, rather than
  // keeping the sheet's casing. See the block above canonicalDept.
  canonicalDept, listDepartments,
});

// ── FMS (Flow Management System) API — see fmsSheet.js wiring further down,
// registered once getGoogleAuth()/ensureLogTab() etc. exist (search "FMS routes").

// ── Clients ───────────────────────────────────────────────────────────────────
app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const rows = await q(`SELECT id, name, contact_person AS contactPerson, mobile, contact_number, email, state, district, address, pin, status, bank_name, account_holder, account_no, ifsc_code, branch_name, division, created_at AS createdAt FROM clients ORDER BY created_at DESC`);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.post('/api/clients', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    if (!b.name?.trim()) return res.status(400).json({ error:'name required' });
    const c = await q('SELECT COUNT(*) AS cnt FROM clients');
    const id = 'VN'+(Number(c[0].cnt)+1).toString().padStart(4,'0');
    await pool.query(
      `INSERT INTO clients (id,name,contact_person,mobile,email,state,district,address,pin,status,bank_name,account_holder,account_no,ifsc_code,branch_name,division)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, b.name.trim(), b.contactPerson||'', b.mobile||'', b.email||'', b.state||'', b.district||'', b.address||'', b.pin||'',
       b.status||'active', b.bankName||'', b.accountHolder||'', b.accountNo||'', b.ifscCode||'', b.branchName||'', b.division||'']
    );
    return res.status(201).json({ success:true, id });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.patch('/api/clients', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    if (!b.id) return res.status(400).json({ error:'id required' });
    await pool.query(
      `UPDATE clients SET name=COALESCE($1,name), contact_person=COALESCE($2,contact_person), mobile=COALESCE($3,mobile), email=COALESCE($4,email),
       state=COALESCE($5,state), district=COALESCE($6,district), address=COALESCE($7,address), pin=COALESCE($8,pin),
       status=COALESCE($9,status), bank_name=COALESCE($10,bank_name), account_holder=COALESCE($11,account_holder),
       account_no=COALESCE($12,account_no), ifsc_code=COALESCE($13,ifsc_code), branch_name=COALESCE($14,branch_name),
       division=COALESCE($15,division)
       WHERE id=$16`,
      [b.name??null, b.contactPerson??null, b.mobile??null, b.email??null, b.state??null, b.district??null, b.address??null, b.pin??null,
       b.status??null, b.bankName??null, b.accountHolder??null, b.accountNo??null, b.ifscCode??null, b.branchName??null, b.division??null, b.id]
    );
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.delete('/api/clients', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error:'id required' });
    await pool.query('DELETE FROM clients WHERE id = $1', [id]);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Google Sheets & Drive Sync (PR/PO/GRN → their respective live sheets) ─────

const PR_SHEET_ID = '18SNUNQPwZMC0OLCKmU8eltvLLY4VC1kO8rZw75UNg1k';
const GRN_SHEET_ID = '1mvhf6SN7_5h1HEuKoBc1CJRqnYwoOAzNAgvGuSbSi38';
const PDF_DRIVE_FOLDER_ID = '1szkgiMRZ8RAvQxQiwOho4Hqd7JO5VzoI';
// PO/PR/GRN each save into their own subfolder of the "PR/PO/GRN ERP pdfs"
// Shared Drive (0AO3U0bKj4seJUk9PVA). This has to be a Shared Drive, not a
// regular "My Drive" folder — service accounts have zero storage quota of
// their own, so file creation in a plain folder fails even with Editor
// access; only a Shared Drive's pooled quota lets them create files at all.
// (The old PDF_DRIVE_FOLDER_ID above is a regular folder, view-only for the
// service account anyway, and kept only for the unused legacy sync functions
// below — never used for a real upload.)
const PO_PDF_DRIVE_FOLDER_ID = '1iFcj9bv3QmIuaNKQSIKrNy6_8FhGzn6e';
const PR_PDF_DRIVE_FOLDER_ID = '1Nr33UmAqIUEC4KQmaAnZlFjhv57mVWi4';
const GRN_PDF_DRIVE_FOLDER_ID = '11ELSLuEbVIqUeibZwmvPiRg-MOUVPJXQ';
const LOG_TAB_NAME = 'Web App Log';
// PO log replaced the old per-PO-spreadsheet "Web App Log" tab with this shared
// monitoring spreadsheet so PO activity shows up alongside other ops tracking.
const PO_MONITORING_SHEET_ID = '19wbm97_bYYsVDCpgOzGHZlriYc81McuPSKpqumf96MI';
// PR creation also logs into "PR Form Responses" — the spreadsheet the store
// team's own Google Form (filled by hand by Sagar/whoever raises the PR) has
// always submitted into, tab "RM_1_res". NOT the "FMS (Stores)" spreadsheet's
// "Monitoring" tab — that was this constant's first home and IS still a real,
// separately-shared sheet, but confirmed (2026-08-08, by the user checking
// their own live view) to not be where the store team actually looks for new
// PRs day to day; verified writes there were landing correctly but going
// unseen. Column layout here (see the write below) is trilingual (Guj/Hindi/
// Eng) and has 6 category-specific "Product Name" columns (Accessory/
// Brazing/CNC/Consumable/Electric/Packing) that the Form's dropdown logic
// fills selectively per submission — we don't have a reliable item->category
// mapping to fill those from here, so only Timestamp/PR No/Name/Vendor/
// Department are written; the rest are left blank rather than guessed.
const PR_MONITORING_SHEET_ID = '1CHOh_MRtlI6Bpw1ztmKthZ7vkgVVNn9xdV48DGU87kY';
const PR_MONITORING_TAB_NAME = 'RM_1_res';
// The archived PR PDF's Drive link, written alongside each synced row so the
// store team can open the actual requisition from the sheet they already
// watch. It goes in column V, which is NOT simply "the first free column":
// the tab has two columns past the Form's own A..T that this server doesn't
// own and must not write —
//   U  Mail_Sent  — stamped by the sheet's own Apps Script (the RM_01 project)
//                   when it mails a new PR out. Writing here first cost a PR's
//                   link (it landed in U, invisible under that header) and
//                   risks confusing the mail script about what it's sent.
//   V  PDF link   — already exists, already labelled, and is exactly this.
// So V is a column the sheet hands us, not one we add: no header is stamped
// (that row belongs to the Form/Apps Script side) and the count of leading
// blanks is derived from the letter below so the two can never drift apart.
const PR_MONITORING_PDF_COL = 'V';
// Cells to fill before the link: everything in A..U. Single-letter columns
// only, which V is — 'A' -> 0, so 'V' -> 21.
const PR_MONITORING_PDF_PAD = PR_MONITORING_PDF_COL.charCodeAt(0) - 65;

// Hosting-panel env-var editors routinely mangle a multi-line PEM key pasted
// from a .env file: surrounding quotes get included literally, CRLF sneaks
// in, or only some of the escaped "\n" sequences survive as real newlines —
// and in practice even that normalization isn't always enough, because some
// panels truncate/alter characters inside a long pasted value outright.
// GOOGLE_PRIVATE_KEY_B64 sidesteps all of that: a base64 blob has no
// newlines, quotes, or other characters a text field could corrupt.
function _normalizeGooglePrivateKey(raw) {
  if (!raw) return raw;
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  return key.replace(/\r\n/g, '\n').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
}

let _googleAuth = null;
function getGoogleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const b64 = process.env.GOOGLE_PRIVATE_KEY_B64?.trim();
  const key = b64 ? Buffer.from(b64, 'base64').toString('utf8') : _normalizeGooglePrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  // This guard used to fail silently — every sync function treated a null
  // return as "nothing to do" with zero logging, so a missing/blank env var
  // in production looked identical to everything working. Always log why.
  if (!email || !key) {
    console.error('[google-sync] Google credentials missing — GOOGLE_SERVICE_ACCOUNT_EMAIL set:', !!email, '| GOOGLE_PRIVATE_KEY set:', !!key, '| GOOGLE_PRIVATE_KEY_B64 set:', !!b64);
    return null;
  }
  if (_googleAuth) return _googleAuth;
  const { google } = require('googleapis');
  _googleAuth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  });
  return _googleAuth;
}

// ── FMS (Flow Management System) — Google-Sheets-backed recurring workflow tracker ──
// Config lives in fms_sheets/fms_sheet_steps/fms_step_doers/fms_extra_rows/fms_intake_fields;
// row data always lives in the live external sheet, never copied into our own DB.
const fmsSheet = require('./backend/lib/fmsSheet.js')({ q, pool, getGoogleAuth });

function fmsGate(req, res, next) {
  if (!FMS_ENABLED) return res.status(404).json({ error: 'FMS is disabled' });
  next();
}

// ── FMS next-step email notification ─────────────────────────────────────────
// Master switch, persisted in app_config. Defaults to OFF (absent key = off) so
// that no mail can go out until an admin explicitly turns notifications on from
// the FMS page — flipping it on is what starts delivery, nothing else.
async function isFmsNotifyEnabled() {
  try {
    const rows = await q(`SELECT "value" FROM app_config WHERE "key" = 'fms_notify_enabled'`);
    return rows.length > 0 && String(rows[0].value) === 'true';
  } catch (e) {
    console.error('[fms-mail] could not read fms_notify_enabled:', e.message);
    return false;
  }
}

function escHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Called fire-and-forget after a step is marked done — it must never delay or
// fail the /done response, and an unreachable SMTP server must never surface as
// a failed "mark done" (the sheet write has already succeeded by then).
async function sendFmsNextStepEmail({ sheet, step, rowNumber, doneByName }) {
  if (!(await isFmsNotifyEnabled())) return;
  if (Number(sheet.notify_enabled ?? 1) === 0) return; // this one flow is muted
  const mailer = getMailer();
  if (!mailer) { console.log('[fms-mail] skipped — SMTP_USER/SMTP_PASS not configured'); return; }

  const info = await fmsSheet.getNextStepNotification({ sheet, step, rowNumber });
  if (!info) { console.log('[fms-mail] no next step to notify for row', rowNumber, 'of', sheet.fms_name); return; }
  const { nextStep, recipients, planValue, details } = info;

  // Cap the detail table — a wide sheet can have 40+ populated columns, which
  // makes an unreadable email and risks Gmail clipping the message.
  const detailRowsHTML = details.slice(0, 12).map(d => `
    <tr>
      <td style="padding:7px 10px;background:#f8fafc;font-weight:600;color:#334155;font-size:12.5px;width:38%">${escHtml(d.header)}</td>
      <td style="padding:7px 10px;color:#1e293b;font-size:12.5px">${escHtml(d.value)}</td>
    </tr>`).join('');

  const subject = `FMS — Your turn: ${nextStep.step_name} (${sheet.fms_name})`;
  for (const u of recipients) {
    try {
      await mailer.sendMail({
        from: `"Task Manager" <${process.env.SMTP_USER}>`,
        to: u.email,
        subject,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
          <div style="background:#0150AA;padding:20px 24px">
            <h2 style="color:#fff;margin:0;font-size:16px">🔔 Next Step Assigned to You</h2>
            <div style="color:#c7dbf5;font-size:12.5px;margin-top:4px">${escHtml(sheet.fms_name)}</div>
          </div>
          <div style="padding:24px">
            <p style="margin:0 0 14px;font-size:14px;color:#1e293b">Hi <strong>${escHtml(u.name || '')}</strong>, the previous step has been completed${doneByName ? ` by <strong>${escHtml(doneByName)}</strong>` : ''}. This row is now pending with you.</p>
            <table style="width:100%;border-collapse:collapse;margin:0 0 16px">
              <tr>
                <td style="padding:7px 10px;background:#eef4fc;font-weight:700;color:#0150AA;font-size:12.5px;width:38%">Your Step</td>
                <td style="padding:7px 10px;color:#0f172a;font-size:12.5px;font-weight:600">${escHtml(nextStep.step_name)}</td>
              </tr>
              <tr>
                <td style="padding:7px 10px;background:#eef4fc;font-weight:700;color:#0150AA;font-size:12.5px">Planned Date</td>
                <td style="padding:7px 10px;color:#0f172a;font-size:12.5px">${escHtml(planValue || '—')}</td>
              </tr>
              <tr>
                <td style="padding:7px 10px;background:#eef4fc;font-weight:700;color:#0150AA;font-size:12.5px">Completed Step</td>
                <td style="padding:7px 10px;color:#0f172a;font-size:12.5px">${escHtml(step.step_name)}</td>
              </tr>
            </table>
            ${detailRowsHTML ? `<div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin:0 0 6px">Entry Details</div>
            <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px">${detailRowsHTML}</table>` : ''}
            <p style="margin:18px 0 0;font-size:12.5px;color:#94a3b8">Open FMS → ${escHtml(sheet.fms_name)} → ${escHtml(nextStep.step_name)} to mark it done. This is an automated notification.</p>
          </div>
        </div>`,
      });
      console.log('[fms-mail] next-step email sent to', u.email, '| step:', nextStep.step_name, '| row:', rowNumber);
    } catch (e) {
      console.error('[fms-mail] failed to send to', u.email, '—', e.message);
    }
  }
}

app.get('/api/fms', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const user = req.session.user;
    const admin = isAdminUser(user);
    const sheets = await fmsSheet.getFmsSheetsWithStats(user.id, admin);
    return res.json(sheets);
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.post('/api/fms', requireAdmin, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    if (!b.fmsName?.trim()) return res.status(400).json({ error: 'FMS name required' });
    if (!b.sheetId?.trim()) return res.status(400).json({ error: 'Google Sheet URL/ID required' });
    const sheet = await fmsSheet.createFmsSheet({
      fmsName: b.fmsName.trim(), sheetName: b.sheetName || '', sheetId: b.sheetId,
      headerRow: b.headerRow || 1, createdBy: req.session.user.id, steps: b.steps || [],
      processCoordinatorId: b.processCoordinatorId || null,
      notifyEnabled: b.notifyEnabled !== false,
    });
    return res.status(201).json(sheet);
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

// Registered before the parametrized /api/fms/:id routes below, since Express
// matches path shape + method in registration order and both these literal
// paths share the same two-segment shape as /api/fms/:id.
app.post('/api/fms/fetch-headers', requireAdmin, fmsGate, async (req, res) => {
  try {
    const { sheetUrlOrId, tabName, headerRow } = req.body;
    if (!sheetUrlOrId || !tabName) return res.status(400).json({ error: 'sheetUrlOrId and tabName required' });
    const headers = await fmsSheet.fetchHeaders(sheetUrlOrId, tabName, headerRow || 1);
    return res.json(headers);
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

// Master on/off switch for the next-step emails. Two segments like /api/fms/:id,
// so like the literal paths above it has to be registered before that route.
app.get('/api/fms/notify-settings', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    return res.json({ enabled: await isFmsNotifyEnabled(), smtpConfigured: !!getMailer() });
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.post('/api/fms/notify-settings', requireAdmin, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const enabled = req.body.enabled === true || req.body.enabled === 'true';
    await pool.query(
      `INSERT INTO app_config ("key","value") VALUES ('fms_notify_enabled',$1) ON CONFLICT ("key") DO UPDATE SET "value"=$2`,
      [String(enabled), String(enabled)]
    );
    console.log('[fms-mail] notifications turned', enabled ? 'ON' : 'OFF', 'by', req.session.user?.name || '');
    return res.json({ success: true, enabled });
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.get('/api/fms/sheet-column-values', requireAdmin, fmsGate, async (req, res) => {
  try {
    const { sheetUrlOrId, tabName, colLetter, headerRow } = req.query;
    if (!sheetUrlOrId || !tabName || !colLetter) return res.status(400).json({ error: 'sheetUrlOrId, tabName and colLetter required' });
    await ensureSchema();
    const result = await fmsSheet.sheetColumnValues(sheetUrlOrId, tabName, colLetter, headerRow || 1);
    return res.json(result);
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

// Backs the "upload" field type. Any FMS user can post here (a step doer
// filling in an attachment is not an admin), so it sits on requireAuth, and
// like the two literal paths above it must precede /api/fms/:id.
app.post('/api/fms/upload', requireAuth, fmsGate, async (req, res) => {
  try {
    const { fileName, dataUrl } = req.body;
    if (!dataUrl) return res.status(400).json({ error: 'dataUrl required' });
    const url = await uploadFmsFileToDrive(dataUrl, fileName);
    if (!url) return res.status(500).json({ error: 'Upload failed' });
    return res.json({ url, name: fileName || '' });
  } catch (err) { console.error("[fms-upload]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.get('/api/fms/:id/pc', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const sheet = await fmsSheet.getFmsSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    const user = req.session.user;
    const admin = isAdminUser(user);
    if (!admin && sheet.process_coordinator_id !== user.id) return res.status(403).json({ error: 'Forbidden' });
    const rows = await fmsSheet.getPendingAcrossSteps(req.params.id);
    return res.json({ sheet, rows });
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.get('/api/fms/:id/sync', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const user = req.session.user;
    const admin = isAdminUser(user);
    const sheets = await fmsSheet.getFmsSheetsWithStats(user.id, admin);
    const one = sheets.find(s => s.id === req.params.id);
    if (!one) return res.status(404).json({ error: 'Not found' });
    return res.json(one);
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.get('/api/fms/:id/intake-fields', requireAdmin, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const sheet = await fmsSheet.getFmsSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    const fields = await fmsSheet.getIntakeFields(req.params.id);
    return res.json({ sheet, fields });
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.put('/api/fms/:id/intake-fields', requireAdmin, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    await fmsSheet.saveIntakeSheetConfig(req.params.id, {
      intakeSheetId: b.intakeSheetId || '', intakeSheetName: b.intakeSheetName || '',
      intakeHeaderRow: b.intakeHeaderRow || null, intakeFormName: b.intakeFormName || '',
    });
    await fmsSheet.saveIntakeFields(req.params.id, b.fields || []);
    return res.json({ success: true });
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.get('/api/fms/:id', requireAdmin, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const sheet = await fmsSheet.getFmsSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    const steps = await fmsSheet.getFullSteps(req.params.id);
    return res.json({ ...sheet, steps });
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.put('/api/fms/:id', requireAdmin, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    const sheet = await fmsSheet.updateFmsSheet(req.params.id, {
      fmsName: b.fmsName || '', sheetName: b.sheetName || '', sheetId: b.sheetId || '',
      headerRow: b.headerRow || 1, steps: b.steps || [], processCoordinatorId: b.processCoordinatorId || null,
      notifyEnabled: b.notifyEnabled !== false,
    });
    return res.json(sheet);
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.delete('/api/fms/:id', requireAdmin, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    await fmsSheet.deleteFmsSheet(req.params.id);
    return res.json({ success: true });
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

// ── FMS task-facing routes ───────────────────────────────────────────────────
app.get('/api/fms-tasks/:id', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const sheet = await fmsSheet.getFmsSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    const user = req.session.user;
    const admin = isAdminUser(user);
    const steps = await fmsSheet.getStepsForTaskView(req.params.id, user.id, admin);
    const relevantSteps = admin ? steps : steps.filter(s => s.isMyStep);
    const pendingByStep = await fmsSheet.getPendingRowsForFmsSteps(req.params.id, relevantSteps, { userName: user.name, isAdmin: admin });
    const stepsOut = steps.map(s => ({
      ...s,
      pending: pendingByStep[s.id] ? pendingByStep[s.id].rows : [],
      totalPending: pendingByStep[s.id] ? pendingByStep[s.id].totalPending : 0,
    }));
    const isCoordinator = admin || sheet.process_coordinator_id === user.id;
    return res.json({ sheet, steps: stepsOut, isCoordinator });
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.get('/api/fms-tasks/:id/intake', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const sheet = await fmsSheet.getFmsSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    const fields = await fmsSheet.getIntakeFields(req.params.id);
    return res.json({ sheet: { id: sheet.id, fms_name: sheet.fms_name, intake_form_name: sheet.intake_form_name }, fields });
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

app.post('/api/fms-tasks/:id/intake', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const sheet = await fmsSheet.getFmsSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    const fields = await fmsSheet.getIntakeFields(req.params.id);
    const result = await fmsSheet.submitIntakeRow(sheet, fields, req.body.values || {}, { userName: req.session.user.name });
    return res.status(201).json(result);
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(400).json({ error: err.message }); }
});

app.post('/api/fms-tasks/:id/steps/:stepId/done', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const sheet = await fmsSheet.getFmsSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    const steps = await fmsSheet.getFullSteps(req.params.id);
    const step = steps.find(s => s.id === req.params.stepId);
    if (!step) return res.status(404).json({ error: 'Step not found' });
    const user = req.session.user;
    const admin = isAdminUser(user);
    if (!admin && !step.isMyStep && !(step.doers || []).some(d => d.user_id === user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { rowNumber, delayReason, extraInputs, doerName } = req.body;
    if (!rowNumber) return res.status(400).json({ error: 'rowNumber required' });
    await fmsSheet.writeStepDone({ sheet, step, rowNumber, delayReason, extraInputs, doerName: doerName || user.name });
    // Fire-and-forget — the sheet write above has already succeeded, so a slow or
    // unreachable SMTP server must not delay this response or turn a successful
    // "mark done" into an error for the doer.
    sendFmsNextStepEmail({ sheet, step, rowNumber, doneByName: doerName || user.name })
      .catch(e => console.error('[fms-mail] next-step notification failed:', e.message));
    return res.json({ success: true });
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

// Client-side refresh path for the Dashboard's FMS tab (server-render calls
// getMyFmsPendingRows() directly inside /api/dashboard — see computeDashboard()).
app.get('/api/fms-dashboard', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const user = req.session.user;
    const admin = isAdminUser(user);
    const rows = await fmsSheet.getMyFmsPendingRows({ userId: user.id, userName: user.name, isAdmin: admin });
    return res.json(rows);
  } catch (err) { console.error("[fms]", req.method, req.path, err.message); return res.status(500).json({ error: err.message }); }
});

async function ensureLogTab(spreadsheetId, tabName, headerRow) {
  const { google } = require('googleapis');
  const auth = getGoogleAuth();
  if (!auth) return;
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === tabName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${tabName}!A1`, valueInputOption: 'RAW', requestBody: { values: [headerRow] } });
    return;
  }
  // A log tab can also exist with nothing in it — someone adds it by hand
  // ahead of the code that fills it. appendLogRow would then drop the first
  // record on row 1, and every /list route reads from row 2, so that record
  // would simply never appear. Write the header when, and only when, row 1 is
  // still blank; a tab that already has one is left exactly as it is.
  try {
    const head = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tabName}'!1:1`, valueRenderOption: 'FORMATTED_VALUE' });
    if (!(head.data.values?.[0] || []).some(c => String(c ?? '').trim())) {
      await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${tabName}'!A1`, valueInputOption: 'RAW', requestBody: { values: [headerRow] } });
    }
  } catch (e) {
    console.error('[log-tab] header check failed for', tabName + ':', e.message);
  }
}

async function appendLogRow(spreadsheetId, tabName, rowValues) {
  const { google } = require('googleapis');
  const auth = getGoogleAuth();
  if (!auth) return;
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: `${tabName}!A:A`, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowValues] },
  });
}

async function uploadPdfToDrive(buffer, filename, folderId = PDF_DRIVE_FOLDER_ID) {
  const { google } = require('googleapis');
  const auth = getGoogleAuth();
  if (!auth) return null;
  const drive = google.drive({ version: 'v3', auth });
  const file = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: 'application/pdf', body: Readable.from(buffer) },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  await drive.permissions.create({ fileId: file.data.id, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true });
  return file.data.webViewLink;
}

function _itemsSummary(items) {
  return (items || []).map(it => it.itemName).filter(Boolean).join(', ');
}

// Matches the existing "7/20/2026 13:41:00" style already used in the FMS
// Monitoring sheet — M/D/YYYY, 24-hour time, in India time regardless of
// which timezone the server itself runs in.
function _timestampForSheet() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('month')}/${get('day')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

// Sheets holds every date as a serial number (days since 1899-12-30) and only
// *renders* it as a date if the cell's number format says to. A log tab whose
// Date column ended up formatted as a plain number therefore answers even
// FORMATTED_VALUE with "46246" instead of "2026-08-12" — unreadable in the
// list pages, and unusable by their date-range filters, which compare plain
// "YYYY-MM-DD" strings. This normalizes such a serial back to ISO; a value
// that's already a date string (the "'"-prefixed literal the log writers use)
// or blank is passed through untouched.
//
// ERP PR Log is the tab this was written for: unlike the PO/GRN/PI writers it
// wrote its Date column unquoted for a long time, so Sheets reparsed each one
// into a real date value and every row logged in that period reads back as a
// serial. The write side is quoted now, but the existing rows stay as they are
// — converting on read is what fixes those without touching the sheet.
function _sheetDateToIso(v) {
  const s = String(v ?? '').trim();
  // 5 digits (optionally with a time fraction) is the only shape a date serial
  // can take in the range below — anything else is left exactly as it came.
  if (!/^\d{5}(\.\d+)?$/.test(s)) return s;
  const n = Number(s);
  // 25569 = 1970-01-01, 73050 = 2100-01-01. A number outside that window is
  // some other quantity that merely looks like a serial, not a date.
  if (!(n >= 25569 && n <= 73050)) return s;
  const d = new Date(Math.round((n - 25569) * 86400000));
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

// Drive upload is a separate failure domain from the Sheets row (e.g. the
// service account can have Sheets access without matching Drive folder
// permissions) — never let a Drive failure block the Sheets sync.
async function safeUploadPdfToDrive(buffer, filename, folderId) {
  try {
    return await uploadPdfToDrive(buffer, filename, folderId);
  } catch (e) {
    console.error('[google-sync] Drive upload failed:', e.message);
    return null;
  }
}

// ── User photos → Drive ───────────────────────────────────────────────
// The DB keeps a 512px square crop (that's what the UI renders); the
// untouched original is archived here so there's a full-resolution copy on
// record. Same Shared Drive as the PR/PO/GRN PDFs — a service account has no
// storage quota of its own, so a plain "My Drive" folder rejects the upload
// no matter what permissions it has.
const PHOTO_SHARED_DRIVE_ID   = '0AO3U0bKj4seJUk9PVA';
const PHOTO_DRIVE_FOLDER_NAME = 'User Photos';
let _photoFolderId = null;

async function ensureUserPhotoFolder(drive) {
  if (_photoFolderId) return _photoFolderId;
  const override = process.env.USER_PHOTO_DRIVE_FOLDER_ID?.trim();
  if (override) { _photoFolderId = override; return _photoFolderId; }
  const found = await drive.files.list({
    q: `name = '${PHOTO_DRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    corpora: 'drive', driveId: PHOTO_SHARED_DRIVE_ID,
    includeItemsFromAllDrives: true, supportsAllDrives: true,
    fields: 'files(id,name)', pageSize: 1,
  });
  if (found.data.files?.length) { _photoFolderId = found.data.files[0].id; return _photoFolderId; }
  const created = await drive.files.create({
    requestBody: { name: PHOTO_DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [PHOTO_SHARED_DRIVE_ID] },
    fields: 'id', supportsAllDrives: true,
  });
  _photoFolderId = created.data.id;
  console.log('[user-photo] created Drive folder', PHOTO_DRIVE_FOLDER_NAME, _photoFolderId);
  return _photoFolderId;
}

function _parseImageDataUrl(dataUrl) {
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  return { mimeType: m[1], buffer: Buffer.from(m[2], 'base64') };
}

const _PHOTO_EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
};

async function uploadUserPhotoToDrive(dataUrl, { userId, userName }) {
  const parsed = _parseImageDataUrl(dataUrl);
  if (!parsed) return null;
  const { google } = require('googleapis');
  const auth = getGoogleAuth();
  if (!auth) return null;
  const drive    = google.drive({ version: 'v3', auth });
  const folderId = await ensureUserPhotoFolder(drive);
  const ext      = _PHOTO_EXT_BY_MIME[parsed.mimeType] || 'jpg';
  const stamp    = _timestampForSheet().replace(/[/:]/g, '-');
  const safeName = String(userName || 'user').replace(/[\\/:*?"<>|]/g, ' ').trim() || 'user';
  const file = await drive.files.create({
    requestBody: { name: `${userId || 'U'} - ${safeName} - ${stamp}.${ext}`, parents: [folderId] },
    media: { mimeType: parsed.mimeType, body: Readable.from(parsed.buffer) },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  await drive.permissions.create({
    fileId: file.data.id, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true,
  }).catch(e => console.error('[user-photo] share failed:', e.message));
  return file.data.webViewLink;
}

// ── FMS attachments → Drive ──────────────────────────────────────────
// Backs the "upload" field type on FMS intake forms and step-completion
// extra fields: the browser posts the picked file as a data URL, it lands in
// a Drive folder, and the shareable link is what gets written into the sheet
// cell. Same Shared Drive as the user photos — a service account has no
// storage quota of its own, so an ordinary "My Drive" folder rejects it.
const FMS_UPLOAD_DRIVE_FOLDER_NAME = 'FMS Uploads';
let _fmsUploadFolderId = null;

async function ensureFmsUploadFolder(drive) {
  if (_fmsUploadFolderId) return _fmsUploadFolderId;
  const override = process.env.FMS_UPLOAD_DRIVE_FOLDER_ID?.trim();
  if (override) { _fmsUploadFolderId = override; return _fmsUploadFolderId; }
  const found = await drive.files.list({
    q: `name = '${FMS_UPLOAD_DRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    corpora: 'drive', driveId: PHOTO_SHARED_DRIVE_ID,
    includeItemsFromAllDrives: true, supportsAllDrives: true,
    fields: 'files(id,name)', pageSize: 1,
  });
  if (found.data.files?.length) { _fmsUploadFolderId = found.data.files[0].id; return _fmsUploadFolderId; }
  const created = await drive.files.create({
    requestBody: { name: FMS_UPLOAD_DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [PHOTO_SHARED_DRIVE_ID] },
    fields: 'id', supportsAllDrives: true,
  });
  _fmsUploadFolderId = created.data.id;
  console.log('[fms-upload] created Drive folder', FMS_UPLOAD_DRIVE_FOLDER_NAME, _fmsUploadFolderId);
  return _fmsUploadFolderId;
}

// Any mime type, not just images (the photo parser above is deliberately
// image-only) — an FMS attachment is just as often a PDF or a spreadsheet.
function _parseAnyDataUrl(dataUrl) {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  return { mimeType: m[1], buffer: Buffer.from(m[2], 'base64') };
}

async function uploadFmsFileToDrive(dataUrl, fileName) {
  const parsed = _parseAnyDataUrl(dataUrl);
  if (!parsed) throw new Error('Unsupported file data');
  const { google } = require('googleapis');
  const auth = getGoogleAuth();
  if (!auth) throw new Error('Google credentials not configured');
  const drive    = google.drive({ version: 'v3', auth });
  const folderId = await ensureFmsUploadFolder(drive);
  const stamp    = _timestampForSheet().replace(/[/:]/g, '-');
  const safeName = String(fileName || 'file').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 120) || 'file';
  const file = await drive.files.create({
    requestBody: { name: `${stamp} - ${safeName}`, parents: [folderId] },
    media: { mimeType: parsed.mimeType, body: Readable.from(parsed.buffer) },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
  await drive.permissions.create({
    fileId: file.data.id, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true,
  }).catch(e => console.error('[fms-upload] share failed:', e.message));
  return file.data.webViewLink;
}

// Drive is its own failure domain: the photo is already saved in the DB by the
// time this runs, so a Drive outage must never turn a successful profile save
// into an error for the user. Callers fire this without awaiting.
async function safeUploadUserPhotoToDrive(dataUrl, meta) {
  try {
    const link = await uploadUserPhotoToDrive(dataUrl, meta);
    if (link) console.log(`[user-photo] archived ${meta.userId} → ${link}`);
    return link;
  } catch (e) {
    console.error('[user-photo] Drive upload failed:', e.message);
    return null;
  }
}

// (The old syncPrToSheet/syncPrToMonitoringSheet/syncPoToSheet/syncGrnToSheet
// functions that used to live here were dead code from a pre-Google-Sheets-
// native implementation — none were ever called, and they depended on
// fetchPrForPdf/buildPrPdfBuffer/etc. helpers that no longer exist in this
// file. Removed; the one live behavior worth keeping — logging each new PR
// into the FMS (Stores) monitoring sheet — is now inlined directly in
// POST /api/pr-creation, right after the PR is actually created, using data
// already on hand instead of re-fetching it.)

// ── PO Creation (fills the store team's live "PO July 2026" Google Sheet directly —
// that sheet IS the database here, nothing is mirrored locally). Each of the 3
// tabs below is a reusable template: submitting a PO overwrites it with the new
// PO's data, exports that tab as a PDF (Drive-hosted), and logs the PO in the
// "ERP PO Log" tab — the template itself stays put, ready for the next PO.
const PO_CREATION_SHEET_ID = '1QB4fZQ1IVFeGs9YKXgGb-dAvsVrTQnBjPCEBzyd0KrM';
const PO_CREATION_LOG_TAB = 'ERP PO Log';

// Cell refs below were reverse-engineered from the live template tabs (formula
// render + merge inspection). Every column not listed here is a formula
// (VLOOKUP against Vendor Details / ITEM_CODES, usually an ARRAYFORMULA spill
// anchored in the header row) and must never be written to directly — writing
// over a spill throws in Sheets. `summary` fields sit below the item table
// (freight/shipping/discount etc. feeding the sheet's own Total formula) —
// always written (defaulting to 0) so a previous PO's numbers can never bleed
// into a new one.
const PO_FORMAT_CONFIG = {
  PurchaseOrder: {
    tabName: 'PurchaseOrder',
    partyLabel: 'CUSTOMER NAME',
    hasShipTo: true,
    header: { poNo: 'J7', date: 'J6', prNo: 'J8', department: 'J9', party: 'A13', shipTo: 'G13', deliverySchedule: 'A16', poValidity: 'C16', paymentTerms: 'G16', poMadeBy: 'J16' },
    items: { firstRow: 18, lastRow: 58, clearCols: ['A', 'J'], fields: { itemCode: 'A', hsnCode: 'D', uom: 'E', qty: 'F', unitPrice: 'G', gst: 'H' } },
    summary: { fields: { freightCharges: 'I61', packingCharges: 'I62', discount: 'I63' }, totalCell: 'I64' },
    // These 3 sit in cells the live template has always reserved for them
    // (label already printed, value cell left blank) but the ERP never wrote
    // to before — only PurchaseOrder's template has this clean a layout;
    // ENR PO/Diamond PO bake their own "YES / NO" placeholder into the label
    // cell itself with no separate value cell, so there's nowhere safe to
    // write those two without overwriting the label text.
    extra: { termsAndConditionsRows: ['A60', 'A61', 'A62', 'A63', 'A64'], comments: 'B66', testCertificateRequired: 'B67' },
  },
  'ENR PO': {
    tabName: 'ENR PO',
    partyLabel: 'VENDOR',
    hasShipTo: false,
    header: { poNo: 'J9', date: 'J8', prNo: 'J10', department: 'J11', party: 'A16', deliverySchedule: 'F23', poValidity: 'G23', paymentTerms: 'B23', poMadeBy: 'A23' },
    items: { firstRow: 26, lastRow: 55, clearCols: ['A', 'J'], fields: { itemCode: 'A', customerCodeRef: 'D', barcode: 'E', stickerQty: 'G', rate: 'H', taxPercent: 'I' } },
    summary: { fields: { shipping: 'J57', other: 'J58', discountPercent: 'I59' }, totalCell: 'J60' },
  },
  'Diamond PO': {
    tabName: 'Diamond PO',
    partyLabel: 'VENDOR',
    hasShipTo: false,
    header: { poNo: 'J9', date: 'J8', prNo: 'J10', department: 'J11', party: 'A16', deliverySchedule: 'G23', poValidity: 'H23', paymentTerms: 'B23', poMadeBy: 'A23' },
    // clearCols stops at K, NOT L: column L holds a real per-row formula
    // (=IF(AND(H=,I=,J=,K=),"",H*I+J*K)) typed into each row individually,
    // not a spill from the header (unlike PurchaseOrder/ENR PO's amount
    // columns) — clearing over it would delete it for good the first time
    // this format is ever submitted. Confirmed still intact; keep it that way.
    items: { firstRow: 27, lastRow: 55, clearCols: ['A', 'K'], fields: { itemCode: 'A', boxQty: 'H', boxRate: 'I', plateQty: 'J', plateRate: 'K' } },
    summary: { fields: { gstPercent: 'J57', shipping: 'K58', other: 'K59', discountPercent: 'J60' }, totalCell: 'K61' },
  },
  // Services, not goods — the one format with no PR upstream and no ITEM_CODES
  // catalog behind it: every line is typed by hand. Its tab was built by
  // duplicating PurchaseOrder and reworking the item band: the ITEM CODE +
  // VLOOKUP description/size columns are gone (a service has no catalog entry
  // to look up), replaced by a free-text SERVICE DESCRIPTION merged across
  // B:G, with a lump-sum AMOUNT typed straight into column I instead of being
  // derived from qty x unit price. Rows 39-58 of the original were deleted, so
  // the whole totals/footer block sits 20 rows higher than PurchaseOrder's —
  // hence the I39..I44 addresses below. Only column J is still a formula
  // (amount + tax, an ARRAYFORMULA anchored at J17), so it must never be
  // written to; keyField marks Description as the line's identity, standing in
  // for itemCode everywhere the generic PO code expects one.
  'Service PO': {
    tabName: 'Service PO',
    partyLabel: 'VENDOR',
    hasShipTo: true,
    header: { poNo: 'J7', date: 'J6', department: 'J9', party: 'A13', shipTo: 'G13', deliverySchedule: 'A16', poValidity: 'C16', paymentTerms: 'G16', poMadeBy: 'J16' },
    items: { firstRow: 18, lastRow: 38, clearCols: ['A', 'J'], keyField: 'description', fields: { sacCode: 'A', description: 'B', gst: 'H', amount: 'I' } },
    // Freight/Packing are meaningless for a service (their labels are blanked
    // out on the tab) but their cells still feed the Total formula, so they
    // stay configured and get zeroed on every submit — same
    // never-let-the-last-PO's-numbers-bleed-through discipline as everywhere else.
    summary: { fields: { freightCharges: 'I41', packingCharges: 'I42', discount: 'I43' }, totalCell: 'I44' },
    // No testCertificateRequired: that's a goods-inspection concept, and its
    // printed label was removed from this tab.
    extra: { termsAndConditionsRows: ['A40', 'A41', 'A42', 'A43', 'A44'], comments: 'B46' },
  },
};

// ITEM_CODES packs three unrelated item catalogs side by side at different
// column ranges — one per PO format — each looked up by the sheet's own
// VLOOKUP formulas.
const PO_ITEM_CATALOG_RANGE = {
  PurchaseOrder: 'A2:C6000',
  'ENR PO': 'AC2:AE6000',
  'Diamond PO': 'Q2:S6000',
};

let _poItemCatalogCache = {}; // format -> { at, rows: [{code,description,size}] }
const PO_ITEM_CATALOG_TTL_MS = 5 * 60 * 1000;

async function _loadPoItemCatalog(format) {
  const cached = _poItemCatalogCache[format];
  if (cached && (Date.now() - cached.at) < PO_ITEM_CATALOG_TTL_MS) return cached.rows;
  const auth = getGoogleAuth();
  if (!auth) return [];
  const { google } = require('googleapis');
  const sheets = google.sheets({ version: 'v4', auth });
  const range = `'ITEM_CODES'!${PO_ITEM_CATALOG_RANGE[format]}`;
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range, valueRenderOption: 'FORMATTED_VALUE' });
  const rows = (result.data.values || [])
    .filter(r => r[0])
    .map(r => ({ code: r[0] || '', description: r[1] || '', size: r[2] || '' }));
  _poItemCatalogCache[format] = { at: Date.now(), rows };
  return rows;
}

// PR/PO numbers display as "PR001"/"PO001" (3-digit, zero-padded) instead of a
// bare integer — grows naturally past 3 digits (e.g. "PO1000") with no special-casing.
function _padSeqNo(prefix, n) {
  return prefix + String(n).padStart(3, '0');
}

// A few PR/PO/GRN log rows were written before the "PR047"/"PO047"-style
// prefix existed and just hold a bare number — normalize either shape to the
// prefixed form so display and used/pending-set comparisons never mismatch
// a bare "171" against a prefixed "PR171" for the same PR.
function _normalizePrNo(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const n = parseInt(s.replace(/^[A-Za-z]+/, ''), 10);
  return isNaN(n) ? s : _padSeqNo('PR', n);
}

// Same bare-vs-prefixed tolerance as _normalizePrNo, generalized to compare
// any log's own No. column against a key from a request — strips any leading
// letters and compares the numeric part, so "PO253" and "253" match the same
// row regardless of which form either happens to be in.
function _seqKey(raw) {
  const s = String(raw ?? '').trim();
  const n = parseInt(s.replace(/^[A-Za-z]+/, ''), 10);
  return isNaN(n) ? s : String(n);
}

// Finds the 0-indexed sheet row whose column-A value matches `key`
// (bare-vs-prefixed tolerant) — shared by anything that needs to locate a
// PO/PR/GRN log row by its own number before acting on it.
async function _findRowIndexByKey(spreadsheetId, tabName, key) {
  const { google } = require('googleapis');
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const colARes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tabName}'!A:A`, valueRenderOption: 'FORMATTED_VALUE' });
  const values = colARes.data.values || [];
  const target = _seqKey(key);
  const rowIndex = values.findIndex((r, i) => i > 0 && _seqKey(r[0]) === target);
  if (rowIndex === -1) { const e = new Error('Entry not found'); e.notFound = true; throw e; }
  return rowIndex;
}

// Sets a single Status cell (0-indexed rowIndex from _findRowIndexByKey,
// converted to a 1-indexed sheet row) for the PO/PR/GRN "Cancel" list
// actions — never deletes or clears anything else in the row.
async function _setLogRowStatus(spreadsheetId, tabName, key, statusColLetter, status) {
  const { google } = require('googleapis');
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const rowIndex = await _findRowIndexByKey(spreadsheetId, tabName, key);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!${statusColLetter}${rowIndex + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status]] },
  });
}

// Removes the whole row a log key sits on. Every other list action in this
// codebase is a Cancel that flips a Status cell and keeps the row; this one
// takes the record out of the sheet and cannot be undone, which is why the
// only routes that call it are behind requireSuperAdmin.
async function _deleteLogRowByKey(spreadsheetId, tabName, key) {
  const { google } = require('googleapis');
  const auth = getGoogleAuth();
  if (!auth) throw new Error('Google Sheets is not configured on this server');
  const sheets = google.sheets({ version: 'v4', auth });
  // 0-indexed into the values array, where 0 is the header row — which is also
  // exactly the 0-based grid index deleteDimension wants.
  const rowIndex = await _findRowIndexByKey(spreadsheetId, tabName, key);
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
  const tab = meta.data.sheets.find(s => s.properties.title === tabName);
  if (!tab) { const e = new Error('Log tab not found'); e.notFound = true; throw e; }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ deleteDimension: { range: { sheetId: tab.properties.sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }] },
  });
}

// Generalizes _setLogRowStatus from "write one column" to "write several
// columns of the same found row in one batch" — needed by Proforma
// Invoice's "Add Price" step, which updates Total/PDF Link/Form JSON/Priced
// By/Priced At/Status on the SAME row rather than appending a new one (the
// one genuine in-place multi-column edit in this codebase's log-tab
// pattern — everything else only ever flips a single Status cell).
async function _updateLogRowCells(spreadsheetId, tabName, key, cellMap) {
  const { google } = require('googleapis');
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const rowIndex = await _findRowIndexByKey(spreadsheetId, tabName, key);
  const data = Object.entries(cellMap).map(([col, value]) => ({ range: `'${tabName}'!${col}${rowIndex + 1}`, values: [[value]] }));
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data } });
  }
}

async function _poSheetMeta() {
  const auth = getGoogleAuth();
  const { google } = require('googleapis');
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: PO_CREATION_SHEET_ID });
  const sheetIdByTitle = {};
  let maxPoNo = 0;
  for (const s of meta.data.sheets) {
    sheetIdByTitle[s.properties.title] = s.properties.sheetId;
    // Legacy archive tabs ("PO 179".."PO 251") from before PDF export replaced
    // tab-duplication — still the floor for numbering, but no new ones get
    // created anymore, so this alone would freeze nextPoNo forever. The real,
    // growing sequence lives in ERP PO Log's own PO No column (read below).
    const m = /^PO\s+(\d+)$/i.exec(s.properties.title.trim());
    if (m) maxPoNo = Math.max(maxPoNo, parseInt(m[1], 10));
  }
  try {
    const logRes = await sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range: `'${PO_CREATION_LOG_TAB}'!A2:A`, valueRenderOption: 'UNFORMATTED_VALUE' });
    for (const row of (logRes.data.values || [])) {
      // Older rows logged a bare integer; newer ones log "PO047" — strip any
      // leading letters so both parse the same way.
      const n = parseInt(String(row[0] ?? '').replace(/^[A-Za-z]+/, ''), 10);
      if (!isNaN(n)) maxPoNo = Math.max(maxPoNo, n);
    }
  } catch (e) {
    // Log tab doesn't exist yet (no PO created via the ERP so far) — fine, the
    // legacy-tab-derived maxPoNo above is the correct floor in that case.
    if (!/unable to parse range/i.test(e.message || '')) console.error('[po-creation] log read for numbering failed:', e.message);
  }
  return { nextPoNo: maxPoNo + 1, sheetIdByTitle, sheetCount: meta.data.sheets.length };
}

// GET /api/po-creation/masters — vendor list, ship-to locations (PurchaseOrder
// only) and the next PO number, all read live off the sheet (no local mirror),
// plus departments — which no longer come from the sheet's own Vendor Details!
// N3:N31 dropdown list but from the app's departments master, so PO Creation
// offers exactly the same departments as every other form. Department is
// written into the PO as a plain cell value, so a name outside that sheet-side
// data-validation list is stored and printed normally.
app.get('/api/po-creation/masters', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const [vendorsRes, shipToRes, departments, meta] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range: `'Vendor Details'!A2:E200`, valueRenderOption: 'FORMATTED_VALUE' }),
      sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range: `'Vendor Details'!I3:I45`, valueRenderOption: 'FORMATTED_VALUE' }),
      listDepartments(),
      _poSheetMeta(),
    ]);
    const vendors = (vendorsRes.data.values || []).filter(r => r[0]).map(r => r[0]);
    const shipToLocations = (shipToRes.data.values || []).filter(r => r[0]).map(r => r[0]);
    return res.json({ vendors, shipToLocations, departments, nextPoNumber: _padSeqNo('PO', meta.nextPoNo) });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// GET /api/po-creation/items?format=...&q=... — item-code typeahead, sourced
// straight from ITEM_CODES (cached in memory a few minutes at a time).
app.get('/api/po-creation/items', requireAuth, async (req, res) => {
  try {
    const format = req.query.format;
    if (!PO_ITEM_CATALOG_RANGE[format]) return res.status(400).json({ error: 'Unknown format' });
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = await _loadPoItemCatalog(format);
    // No cap — used to silently slice(0, 50)/slice(0, 500), which hid real
    // catalog rows from a blank/focus search (see po-creation.js's runSearch,
    // fired on focus too) once a format held more items than that. The whole
    // point of this endpoint is "everything in the sheet", so return it all.
    const matches = q ? rows.filter(r => r.code.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) : rows;
    return res.json(matches);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// The docs.google.com PDF-export pipeline (below) is a separate subsystem
// from the Sheets values API — a write is fully recalculated and readable
// via the API almost instantly, but the export/print renderer can lag a
// moment behind, so exporting immediately after a write can render item
// rows and totals as blank/0 even though the formulas themselves are intact
// and the very next API read already shows the correct numbers. This short
// pause before every export gives that renderer time to catch up.
function _sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Renders one template tab to PDF via the same authenticated export endpoint
// Sheets' own UI uses for File > Download > PDF (scoped to a single gid) —
// there's no per-tab PDF export in the documented Sheets/Drive API, so this
// borrows the docs.google.com export URL with an OAuth bearer token instead
// of a browser session cookie. Shared by PO Creation and GRN Creation (any
// spreadsheet the same service account can read).
// colRange (optional): { c1, c2 } 0-indexed, c2 exclusive — restricts which
// columns the export treats as printable. Without it, Sheets exports the
// tab's FULL grid width (gridProperties.columnCount), and fitw=true then
// scales the whole thing to fit an A4 page — if the tab's grid is far wider
// than its visible template (GRN's is 34 cols wide, template only uses
// A:N/14), the real content gets shrunk to a fraction of its size to make
// room for columns of empty space nobody can see. Pass colRange to pin the
// export to just the template's actual columns instead.
async function _exportSheetTabPdf(spreadsheetId, sourceSheetId, colRange) {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const rangeParams = colRange ? `&c1=${colRange.c1}&c2=${colRange.c2}` : '';
  // Optional row window — the PI template tab is 80 rows tall but only ~69 of
  // them are the invoice, and the trailing blanks otherwise spill a second,
  // empty page into the PDF.
  const rowParams = colRange && colRange.r2 != null ? `&r1=${colRange.r1 || 0}&r2=${colRange.r2}` : '';
  // Portrait unless the caller opts out. Nothing opts out today; the Proforma
  // Invoice used to, on the assumption its 14-column table could not fit an A4
  // portrait page. With scale=4 it does — see the note on its own export call.
  const portrait = !colRange || colRange.portrait !== false;
  // fitw=true fits to WIDTH — which scales a narrow sheet UP, making a page
  // that was 6px too tall overflow onto a second sheet. scale=4 is Sheets'
  // "fit to page": it only ever scales down, and only as far as it must, so
  // the document always lands on one page. The PI asks for it; PO/PR/GRN keep
  // the fit-to-width behaviour their layouts were tuned against.
  const fitMode = colRange && colRange.scale ? `&scale=${colRange.scale}` : '&fitw=true';
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`
    + `?format=pdf&gid=${sourceSheetId}&size=A4&portrait=${portrait}${fitMode}`
    + `&gridlines=false&printtitle=false&sheetnames=false`
    + `&top_margin=0.3&bottom_margin=0.3&left_margin=0.3&right_margin=0.3`
    + rangeParams + rowParams;
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!resp.ok) throw new Error('PDF export failed: HTTP ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.slice(0, 4).toString() !== '%PDF') throw new Error('PDF export returned non-PDF content');
  return buf;
}

// POST /api/po-creation — fills the live template tab for the chosen format,
// exports it as a PDF (saved to Drive), and logs the PO in "ERP PO Log". This
// IS the database write; nothing is stored locally.
app.post('/api/po-creation', requireAuth, async (req, res) => {
  try {
    const cfg = PO_FORMAT_CONFIG[req.body?.format];
    if (!cfg) return res.status(400).json({ error: 'Unknown PO format' });
    const { date, prNo, department: departmentRaw, party, shipTo, deliverySchedule, poValidity, paymentTerms, poMadeBy, items, summary, termsAndConditions, comments, testCertificateRequired } = req.body;
    // One spelling on the sheet, the PO log and the app — see canonicalDept.
    const department = await canonicalDept(departmentRaw);
    if (!date || !party || !poMadeBy) return res.status(400).json({ error: 'Date, ' + cfg.partyLabel + ' and PO Made By are required' });
    // A line "exists" if its identity column is filled — Item Code on the three
    // goods formats, Description on Service PO (which has no item codes at all).
    const keyField = cfg.items.keyField || 'itemCode';
    const cleanItems = (Array.isArray(items) ? items : []).filter(it => it && String(it[keyField] || '').trim());
    if (!cleanItems.length) return res.status(400).json({ error: 'Add at least one item' });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    const { nextPoNo, sheetIdByTitle } = await _poSheetMeta();
    const poNoFormatted = _padSeqNo('PO', nextPoNo);
    const tab = cfg.tabName;
    const sourceSheetId = sheetIdByTitle[tab];
    if (sourceSheetId === undefined) return res.status(500).json({ error: `Template tab "${tab}" not found in the PO sheet` });

    // 1) Clear the previous PO's item rows so nothing from it bleeds into this one.
    await sheets.spreadsheets.values.clear({
      spreadsheetId: PO_CREATION_SHEET_ID,
      range: `'${tab}'!${cfg.items.clearCols[0]}${cfg.items.firstRow}:${cfg.items.clearCols[1]}${cfg.items.lastRow}`,
    });

    // 2) Write header fields, item rows, and summary fields (freight/shipping/
    // discount/GST%) in one batch. Summary fields are always written — even
    // when 0 — since they feed the sheet's own Total formula and must never
    // carry over a previous PO's numbers.
    const data = [];
    const put = (a1, value) => { if (value !== undefined && value !== null && value !== '') data.push({ range: `'${tab}'!${a1}`, values: [[value]] }); };
    put(cfg.header.poNo, poNoFormatted);
    put(cfg.header.date, date);
    // Service PO has no P.R. NO cell at all (services are raised as a PO
    // directly, never off a PR) — guard rather than building an "!undefined" range.
    if (cfg.header.prNo) put(cfg.header.prNo, prNo);
    put(cfg.header.department, department);
    put(cfg.header.party, party);
    if (cfg.hasShipTo) put(cfg.header.shipTo, shipTo);
    put(cfg.header.deliverySchedule, deliverySchedule);
    put(cfg.header.poValidity, poValidity);
    put(cfg.header.paymentTerms, paymentTerms);
    put(cfg.header.poMadeBy, poMadeBy);

    Object.entries(cfg.summary.fields).forEach(([field, a1]) => {
      data.push({ range: `'${tab}'!${a1}`, values: [[parseFloat(summary?.[field]) || 0]] });
    });

    // Terms & Conditions / Comments / Test Certificate Required (Purchase-
    // Order format only, see PO_FORMAT_CONFIG.extra above) — always written,
    // blank or not, same discipline as the summary fields above: these cells
    // must never keep showing a previous PO's leftover text.
    if (cfg.extra?.termsAndConditionsRows) {
      const lines = String(termsAndConditions || '').split('\n').map(s => s.trim());
      cfg.extra.termsAndConditionsRows.forEach((a1, i) => data.push({ range: `'${tab}'!${a1}`, values: [[lines[i] || '']] }));
    }
    if (cfg.extra?.comments) data.push({ range: `'${tab}'!${cfg.extra.comments}`, values: [[comments || '']] });
    if (cfg.extra?.testCertificateRequired) data.push({ range: `'${tab}'!${cfg.extra.testCertificateRequired}`, values: [[testCertificateRequired || '']] });

    cleanItems.forEach((it, i) => {
      const row = cfg.items.firstRow + i;
      if (row > cfg.items.lastRow) return; // beyond the template's own capacity — drop silently
      Object.entries(cfg.items.fields).forEach(([field, col]) => put(`${col}${row}`, it[field]));
    });

    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: PO_CREATION_SHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      });
    }

    // A write is already fully recalculated internally, but both the very
    // next values.get (the Total read-back below) and the PDF export can
    // otherwise catch the sheet mid-recalculation and see stale/blank
    // formula results — this single pause covers both.
    await _sleep(2000);

    // 3) Read back the sheet's own computed Total (single source of truth —
    // never recompute the formula's math server-side).
    let totalAmount = null;
    try {
      const totalRes = await sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range: `'${tab}'!${cfg.summary.totalCell}`, valueRenderOption: 'UNFORMATTED_VALUE' });
      totalAmount = totalRes.data.values?.[0]?.[0] ?? null;
    } catch (e) { console.error('[po-creation] total read-back failed:', e.message); }

    // 4) Export this fill as a PDF and save it to Drive — replaces the old
    // per-PO archive-tab approach. A PDF/Drive hiccup must never block the
    // PO itself from being created (same resilience as the PR/PO PDF sync).
    let pdfLink = null;
    try {
      const pdfBuffer = await _exportSheetTabPdf(PO_CREATION_SHEET_ID, sourceSheetId);
      pdfLink = await safeUploadPdfToDrive(pdfBuffer, `${poNoFormatted} - ${tab}.pdf`, PO_PDF_DRIVE_FOLDER_ID);
    } catch (e) { console.error('[po-creation] PDF export failed:', e.message); }

    // 5) Log this PO so the ERP can list it (the sheet is still the database —
    // this is just another tab in it, same pattern as the existing Monitoring/
    // Web App Log tabs already used elsewhere in this app).
    const sessUser = req.session?.user;
    // "PR No" is appended at the end (not inserted after "PO No") so the
    // column positions of every already-logged row stay valid — this column
    // was added later, on top of an already-populated log tab.
    // "Form JSON" is appended at the end so existing rows' column positions
    // stay valid — same discipline as "PR No" above. It's a full snapshot of
    // every field the create form needs (not just what has its own log
    // column) — the only other place a past PO's items are recoverable from,
    // since the live template tab only ever reflects the most recent
    // submission for that format.
    // "Status" is likewise appended at the end — defaults to "Active"; the PO
    // List "Cancel" action flips it to "Cancelled" in place, never deleting
    // the row (see PUT /api/po-creation/cancel below).
    await ensureLogTab(PO_CREATION_SHEET_ID, PO_CREATION_LOG_TAB, ['PO No', 'Format', 'Date', 'Party', 'Department', 'Total Amount (INR)', 'PDF Link', 'Created By', 'Created At', 'PR No', 'Form JSON', 'Status']);
    await appendLogRow(PO_CREATION_SHEET_ID, PO_CREATION_LOG_TAB, [
      // Leading "'" forces the ISO date to stay literal text instead of being
      // reparsed into a locale-formatted date — the PO List page's date-range
      // filter compares these as plain "YYYY-MM-DD" strings.
      poNoFormatted, tab, "'" + date, party, department || '', totalAmount ?? '', pdfLink || '', sessUser?.name || '', _timestampForSheet(), prNo || '',
      JSON.stringify({ format: tab, date, prNo, department, party, shipTo, deliverySchedule, poValidity, paymentTerms, poMadeBy, items: cleanItems, summary, termsAndConditions, comments, testCertificateRequired }),
      'Active',
    ]);

    return res.json({ success: true, poNumber: poNoFormatted, totalAmount, pdfLink });
  } catch (e) { console.error('[po-creation] failed:', e.message); return res.status(500).json({ error: e.message }); }
});

// GET /api/po-creation/list — recent POs created via the ERP, read straight
// from the "ERP PO Log" tab (most recent first).
app.get('/api/po-creation/list', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range: `'${PO_CREATION_LOG_TAB}'!A2:L1000`, valueRenderOption: 'FORMATTED_VALUE' });
    const rows = (result.data.values || []).filter(r => r[0]).map(r => {
      let form = null;
      try { form = JSON.parse(r[10] || 'null'); } catch { form = null; }
      return {
        poNo: r[0] || '', format: r[1] || '', date: _sheetDateToIso(r[2]), party: r[3] || '', department: r[4] || '',
        total: r[5] || '', pdfLink: r[6] || '', createdBy: r[7] || '', createdAt: r[8] || '', prNo: r[9] || '', form,
        status: r[11] || 'Active',
      };
    }).reverse();
    return res.json(rows.slice(0, 200));
  } catch (e) {
    // No PO has been created via the ERP yet — the log tab doesn't exist.
    if (/unable to parse range/i.test(e.message || '')) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// PUT /api/po-creation/cancel?poNo=... — marks that PO's row Cancelled in
// "ERP PO Log" (column L) instead of deleting it: the row stays for history/
// audit, but drops out of GRN Creation's PO picker. The archived PDF in
// Drive and the PO's own number are both untouched/not freed for reuse.
app.put('/api/po-creation/cancel', requireAuth, async (req, res) => {
  try {
    const poNo = req.query.poNo;
    if (!poNo) return res.status(400).json({ error: 'poNo is required' });
    await _setLogRowStatus(PO_CREATION_SHEET_ID, PO_CREATION_LOG_TAB, poNo, 'L', 'Cancelled');
    return res.json({ success: true });
  } catch (e) { return res.status(e.notFound ? 404 : 500).json({ error: e.message }); }
});

// Owner-only. Cancel above keeps the PO on the log; this takes the row out
// of the sheet altogether. See SUPER_ADMIN_EMAIL.
app.delete('/api/po-creation', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const poNo = req.query.poNo;
    if (!poNo) return res.status(400).json({ error: 'poNo is required' });
    await _deleteLogRowByKey(PO_CREATION_SHEET_ID, PO_CREATION_LOG_TAB, poNo);
    return res.json({ success: true });
  } catch (e) { return res.status(e.notFound ? 404 : 500).json({ error: e.message }); }
});

// GET /api/po-creation/pending-prs — PRs (from the separate "PR July 2026"
// sheet's own ERP PR Log) that haven't been used on any PO yet, for the P.R.
// NO field's suggestion dropdown. "Pending" = its PR No doesn't appear in the
// PR No column POs have already logged against, and it isn't Cancelled.
app.get('/api/po-creation/pending-prs', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    let prRows = [];
    try {
      const prRes = await sheets.spreadsheets.values.get({ spreadsheetId: PR_CREATION_SHEET_ID, range: `'${PR_CREATION_LOG_TAB}'!A2:L1000`, valueRenderOption: 'FORMATTED_VALUE' });
      prRows = prRes.data.values || [];
    } catch (e) {
      if (!/unable to parse range/i.test(e.message || '')) throw e;
    }

    let usedPrNos = new Set();
    try {
      const poRes = await sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range: `'${PO_CREATION_LOG_TAB}'!J2:J1000`, valueRenderOption: 'FORMATTED_VALUE' });
      usedPrNos = new Set((poRes.data.values || []).map(r => _normalizePrNo(r[0])).filter(Boolean));
    } catch (e) {
      if (!/unable to parse range/i.test(e.message || '')) throw e;
    }

    const pending = prRows
      .filter(r => r[0] && (r[11] || 'Active') !== 'Cancelled' && !usedPrNos.has(_normalizePrNo(r[0])))
      .map(r => {
        let items = [];
        try { items = JSON.parse(r[10] || 'null')?.items || []; } catch { items = []; }
        return { prNo: _normalizePrNo(r[0]), prTabName: r[1] || '', date: _sheetDateToIso(r[2]), party: r[3] || '', requestedBy: r[4] || '', department: r[5] || '', items };
      })
      .reverse();
    return res.json(pending.slice(0, 200));
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ── PR Creation (fills the store team's live "PR July 2026" Google Sheet directly —
// that sheet IS the database here, nothing is mirrored locally). Mirrors PO Creation's
// approach exactly: each of the 4 tabs below is a reusable template; submitting a PR
// overwrites it, exports that tab as a PDF (Drive-hosted), and logs the PR in the
// "ERP PR Log" tab — the template itself stays put, ready for the next PR. Distinct
// from PR_SHEET_ID's other (unused) consumers above (syncPrToSheet / Web App Log),
// which do a one-way summary log of a DB-created PR — a different shape, left alone.
const PR_CREATION_SHEET_ID = PR_SHEET_ID;
const PR_CREATION_LOG_TAB = 'ERP PR Log';

// Cell refs reverse-engineered from the live template tabs (formula render + merge
// inspection), same discipline as PO_FORMAT_CONFIG above. Every column not listed
// here is a formula (VLOOKUP/ARRAYFORMULA spill against the matching ITEM_CODE*
// tab) and must never be written to directly. Department is a formula derived from
// the first item's own category on every format except ALU, where it's manual.
const PR_FORMAT_CONFIG = {
  ITEM_CODE: {
    tabName: 'Purchase Requisition',
    partyLabel: 'VENDOR NAME',
    header: { prNo: 'B4', requestedBy: 'C4', vendorName: 'E4', personWhoRaisedPr: 'F4', estimatedDelDate: 'I4', termsOfPayment: 'J4', dateRequested: 'L4' },
    departmentCell: 'D4',
    // clearCols stops at K, NOT L: column L holds a real per-row formula
    // (=iferror(E{row}*I{row},"")) typed into each row individually, not an
    // ARRAYFORMULA spill from the header — clearing over it deletes it for
    // good (confirmed: it happened after the first 2 live submissions and
    // had to be restored). Never widen this range to include L.
    items: { firstRow: 7, lastRow: 20, clearCols: ['B', 'K'], fields: { itemCode: 'B', monthlyConsumption: 'D', qtyRequired: 'E', uom: 'F', stock: 'G', lastOrderedDate: 'H', lastUnitPrice: 'I', tax: 'J' } },
    summary: { totalCell: 'L21' },
  },
  PACKING_STICKER: {
    tabName: 'PURCHASE REQUISITION(PACKING_STICKER)',
    partyLabel: 'PARTY NAME',
    header: { prNo: 'A3', requestedBy: 'B3', orderNo: 'C3', partyName: 'D3', dateRequested: 'K3' },
    items: { firstRow: 7, lastRow: 25, clearCols: ['A', 'K'], fields: { itemCode: 'A', stickerQty: 'I', rate: 'J' } },
    summary: { totalCell: 'K26' },
  },
  PACKING_BOX: {
    tabName: 'PURCHASE REQUISITION(PACKING_BOX)',
    partyLabel: 'PARTY NAME',
    header: { prNo: 'A4', requestedBy: 'B4', orderNo: 'C4', partyName: 'D4', termsOfPayment: 'L4', estimatedDelDate: 'M4', dateRequested: 'N4' },
    // clearCols stops at M, NOT N: column N holds a real per-row formula
    // (=iferror(SUMPRODUCT(J,K)+SUMPRODUCT(L,M),"")) per row, same class of
    // bug as ITEM_CODE's column L above — confirmed still intact (this
    // format hasn't been submitted live yet), but would be destroyed on
    // first use if N stayed in the clear range. Never widen this to include N.
    items: { firstRow: 8, lastRow: 22, clearCols: ['A', 'M'], fields: { itemCode: 'A', boxQty: 'J', boxRate: 'K', plateQty: 'L', plateRate: 'M' } },
    summary: { totalCell: 'N23' },
    // Page setup for the PDF export (see _exportPrTabPdf). This is the widest
    // PR template — 14 columns, several of them long text — so it prints
    // landscape. c1/c2 pin the export to A:N: the tab's GRID is 29 columns
    // wide, and without them fitw=true shrinks the template to ~half size to
    // make room for 15 columns of empty space nobody can see.
    pdf: { portrait: false, c1: 0, c2: 14 },
  },
  ALU: {
    tabName: 'purchase_requisition(ALU)',
    partyLabel: 'VENDOR NAME',
    header: { prNo: 'B4', requestedBy: 'C4', department: 'D4', vendorName: 'E4', termsOfPayment: 'G4', estimatedDeliveryDate: 'H4', dateRequested: 'I4' },
    items: { firstRow: 7, lastRow: 20, clearCols: ['B', 'I'], fields: { itemCode: 'B', qtyRequired: 'E', uom: 'F', tax: 'G', rate: 'H', stock: 'I' } },
    summary: { totalCell: 'H21' },
  },
};

const PR_ITEM_CATALOG_RANGE = {
  ITEM_CODE: { tab: 'ITEM_CODE', range: 'A2:C1003' },
  PACKING_STICKER: { tab: 'ITEM_CODE(PACKING_STICKER)', range: 'A2:C1082' },
  PACKING_BOX: { tab: 'ITEM_CODE(PACKING_BOX)', range: 'A2:C989' },
  ALU: { tab: 'ITEM_CODE(ALU)', range: 'A2:C2103' },
};

let _prItemCatalogCache = {}; // format -> { at, rows: [{code,description,size}] }

async function _loadPrItemCatalog(format) {
  const cached = _prItemCatalogCache[format];
  if (cached && (Date.now() - cached.at) < PO_ITEM_CATALOG_TTL_MS) return cached.rows;
  const auth = getGoogleAuth();
  if (!auth) return [];
  const { google } = require('googleapis');
  const sheets = google.sheets({ version: 'v4', auth });
  const cat = PR_ITEM_CATALOG_RANGE[format];
  if (!cat) return [];
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: PR_CREATION_SHEET_ID, range: `'${cat.tab}'!${cat.range}`, valueRenderOption: 'FORMATTED_VALUE' });
  const rows = (result.data.values || [])
    .filter(r => r[0])
    .map(r => ({ code: r[0] || '', description: r[1] || '', size: r[2] || '' }));
  _prItemCatalogCache[format] = { at: Date.now(), rows };
  return rows;
}

async function _prSheetMeta() {
  const auth = getGoogleAuth();
  const { google } = require('googleapis');
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: PR_CREATION_SHEET_ID });
  const sheetIdByTitle = {};
  let maxPrNo = 0;
  for (const s of meta.data.sheets) {
    sheetIdByTitle[s.properties.title] = s.properties.sheetId;
    // Legacy archive tabs — no new ones get created since PDF export replaced
    // tab-duplication, so this alone would freeze nextPrNo forever. The real,
    // growing sequence lives in ERP PR Log's own PR No column (read below).
    const m = /^PR\s+(\d+)$/i.exec(s.properties.title.trim());
    if (m) maxPrNo = Math.max(maxPrNo, parseInt(m[1], 10));
  }
  try {
    const logRes = await sheets.spreadsheets.values.get({ spreadsheetId: PR_CREATION_SHEET_ID, range: `'${PR_CREATION_LOG_TAB}'!A2:A`, valueRenderOption: 'UNFORMATTED_VALUE' });
    for (const row of (logRes.data.values || [])) {
      // Older rows logged a bare integer; newer ones log "PR047" — strip any
      // leading letters so both parse the same way.
      const n = parseInt(String(row[0] ?? '').replace(/^[A-Za-z]+/, ''), 10);
      if (!isNaN(n)) maxPrNo = Math.max(maxPrNo, n);
    }
  } catch (e) {
    if (!/unable to parse range/i.test(e.message || '')) console.error('[pr-creation] log read for numbering failed:', e.message);
  }
  return { nextPrNo: maxPrNo + 1, sheetIdByTitle };
}

// Same borrowed docs.google.com export approach as _exportPoTabPdf — no per-tab
// PDF export exists in the documented Sheets/Drive API.
// opts — the format's own `pdf` config, absent on formats that keep the
// portrait default: { portrait, c1, c2 } (c1/c2 0-indexed, c2 exclusive).
async function _exportPrTabPdf(sourceSheetId, opts) {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const portrait = !opts || opts.portrait !== false;
  const rangeParams = opts && opts.c2 != null ? `&c1=${opts.c1 || 0}&c2=${opts.c2}` : '';
  const url = `https://docs.google.com/spreadsheets/d/${PR_CREATION_SHEET_ID}/export`
    + `?format=pdf&gid=${sourceSheetId}&size=A4&portrait=${portrait}&fitw=true`
    + `&gridlines=false&printtitle=false&sheetnames=false`
    + `&top_margin=0.3&bottom_margin=0.3&left_margin=0.3&right_margin=0.3`
    + rangeParams;
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!resp.ok) throw new Error('PDF export failed: HTTP ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.slice(0, 4).toString() !== '%PDF') throw new Error('PDF export returned non-PDF content');
  return buf;
}

// GET /api/pr-creation/masters — vendor list and the next PR number, read live
// off the sheet (no local mirror). No department master exists in this sheet —
// it's formula-derived on every format except ALU, where it's a free-text field.
app.get('/api/pr-creation/masters', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const [vendorsRes, departments, meta] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: PR_CREATION_SHEET_ID, range: `'Vendor Name'!A3:A1000`, valueRenderOption: 'FORMATTED_VALUE' }),
      listDepartments(),
      _prSheetMeta(),
    ]);
    const vendors = (vendorsRes.data.values || []).filter(r => r[0]).map(r => r[0]);
    // Departments (ALU's manual Department dropdown, and the PR Form tab's own
    // Department multi-select) come from the app's departments master — the
    // same list every other form uses. They used to be two separate hardcoded
    // lists in pr-creation.js, spelled differently from each other and from PO
    // Creation's. Department is only ever a label on the PR record/log here, so
    // it's not tied to anything structural in the sheet.
    return res.json({ vendors, departments, nextPrNumber: _padSeqNo('PR', meta.nextPrNo) });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// GET /api/pr-creation/items?format=...&q=... — item-code typeahead, sourced
// straight from the format's ITEM_CODE* tab (cached a few minutes at a time).
app.get('/api/pr-creation/items', requireAuth, async (req, res) => {
  try {
    const format = req.query.format;
    if (!PR_ITEM_CATALOG_RANGE[format]) return res.status(400).json({ error: 'Unknown format' });
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = await _loadPrItemCatalog(format);
    // No cap — see the matching comment on /api/po-creation/items above.
    const matches = q ? rows.filter(r => r.code.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) : rows;
    return res.json(matches);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// POST /api/pr-creation/items — for when the item picker comes up empty:
// appends a brand-new row to that format's own item-master tab (col A: code,
// B: description, C: size). Plenty of headroom in every format's
// PR_ITEM_CATALOG_RANGE (900-2000+ rows) below the real data, so this can
// never collide with the template/summary areas of the sheet. The in-memory
// catalog cache is invalidated so the new item is searchable immediately.
app.post('/api/pr-creation/items', requireAuth, async (req, res) => {
  try {
    const format = req.body?.format;
    if (!PR_ITEM_CATALOG_RANGE[format]) return res.status(400).json({ error: 'Unknown format' });
    const code = String(req.body?.code || '').trim();
    const description = String(req.body?.description || '').trim();
    const size = String(req.body?.size || '').trim();
    if (!code) return res.status(400).json({ error: 'Item code is required' });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });

    const rows = await _loadPrItemCatalog(format);
    if (rows.some(r => r.code.trim().toLowerCase() === code.toLowerCase())) {
      return res.status(409).json({ error: `Item code "${code}" already exists — search for it instead` });
    }

    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const cat = PR_ITEM_CATALOG_RANGE[format];
    await sheets.spreadsheets.values.append({
      spreadsheetId: PR_CREATION_SHEET_ID,
      range: `'${cat.tab}'!A:C`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[code, description, size]] },
    });

    delete _prItemCatalogCache[format]; // next search re-reads the sheet and sees this row
    console.log('[pr-creation] new item added:', code, '->', cat.tab);
    return res.json({ success: true, code, description, size });
  } catch (e) { console.error('[pr-creation] add item failed:', e.message); return res.status(500).json({ error: e.message }); }
});

// POST /api/pr-creation — fills the live template tab for the chosen format,
// exports it as a PDF (saved to Drive), and logs the PR in "ERP PR Log". This
// IS the database write; nothing is stored locally.
app.post('/api/pr-creation', requireAuth, async (req, res) => {
  try {
    const cfg = PR_FORMAT_CONFIG[req.body?.format];
    if (!cfg) return res.status(400).json({ error: 'Unknown PR format' });
    const {
      requestedBy, vendorName, partyName, personWhoRaisedPr, orderNo,
      department: departmentRaw, termsOfPayment, estimatedDelDate, dateRequested, items,
    } = req.body;
    // One spelling on the sheet, the PR log and the app — see canonicalDept.
    const department = await canonicalDept(departmentRaw);
    const party = vendorName || partyName || '';
    if (!requestedBy || !party) return res.status(400).json({ error: 'Requested By and ' + cfg.partyLabel + ' are required' });
    const cleanItems = (Array.isArray(items) ? items : []).filter(it => it && String(it.itemCode || '').trim());
    if (!cleanItems.length) return res.status(400).json({ error: 'Add at least one item' });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    const { nextPrNo, sheetIdByTitle } = await _prSheetMeta();
    const prNoFormatted = _padSeqNo('PR', nextPrNo);
    const tab = cfg.tabName;
    const sourceSheetId = sheetIdByTitle[tab];
    if (sourceSheetId === undefined) return res.status(500).json({ error: `Template tab "${tab}" not found in the PR sheet` });

    // 1) Clear the previous PR's item rows so nothing from it bleeds into this one.
    await sheets.spreadsheets.values.clear({
      spreadsheetId: PR_CREATION_SHEET_ID,
      range: `'${tab}'!${cfg.items.clearCols[0]}${cfg.items.firstRow}:${cfg.items.clearCols[1]}${cfg.items.lastRow}`,
    });

    // 2) Write header fields and item rows in one batch.
    const data = [];
    const put = (a1, value) => { if (a1 && value !== undefined && value !== null && value !== '') data.push({ range: `'${tab}'!${a1}`, values: [[value]] }); };
    put(cfg.header.prNo, prNoFormatted);
    put(cfg.header.requestedBy, requestedBy);
    put(cfg.header.vendorName, party);
    put(cfg.header.partyName, party);
    put(cfg.header.personWhoRaisedPr, personWhoRaisedPr);
    put(cfg.header.orderNo, orderNo);
    put(cfg.header.department, department); // ALU only — the other formats derive it
    put(cfg.header.termsOfPayment, termsOfPayment);
    put(cfg.header.estimatedDelDate, estimatedDelDate);
    put(cfg.header.estimatedDeliveryDate, estimatedDelDate);
    put(cfg.header.dateRequested, dateRequested);

    cleanItems.forEach((it, i) => {
      const row = cfg.items.firstRow + i;
      if (row > cfg.items.lastRow) return; // beyond the template's own capacity — drop silently
      Object.entries(cfg.items.fields).forEach(([field, col]) => put(`${col}${row}`, it[field]));
    });

    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: PR_CREATION_SHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      });
    }

    // A write is already fully recalculated internally, but both the very
    // next values.get (the Total/Department read-back below) and the PDF
    // export can otherwise catch the sheet mid-recalculation and see
    // stale/blank formula results — this single pause covers both.
    await _sleep(2000);

    // 3) Read back the sheet's own computed Total (single source of truth), and —
    // for formats with a formula-derived Department cell (departmentCell) and
    // no explicit user selection — the formula's own guess, for the log.
    // department (the dropdown the user picked, see PR_DEPARTMENTS in
    // pr-creation.js) always wins when present: it's never written into the
    // sheet itself (cfg.header.department is undefined for these formats, so
    // the put() call above already no-ops — the live formula cell is never
    // touched), it just overrides what our own records show instead of
    // whatever the formula happened to derive from the first item.
    let totalAmount = null, departmentOut = department || '';
    try {
      const deptCell = cfg.header.department ? null : cfg.departmentCell;
      const ranges = [`'${tab}'!${cfg.summary.totalCell}`];
      if (deptCell && !department) ranges.push(`'${tab}'!${deptCell}`);
      const readRes = await sheets.spreadsheets.values.batchGet({ spreadsheetId: PR_CREATION_SHEET_ID, ranges, valueRenderOption: 'UNFORMATTED_VALUE' });
      totalAmount = readRes.data.valueRanges?.[0]?.values?.[0]?.[0] ?? null;
      if (deptCell && !department) departmentOut = readRes.data.valueRanges?.[1]?.values?.[0]?.[0] ?? '';
    } catch (e) { console.error('[pr-creation] total/department read-back failed:', e.message); }

    // 4) Export this fill as a PDF and save it to Drive — a Drive hiccup must
    // never block the PR itself from being created.
    let pdfLink = null;
    try {
      const pdfBuffer = await _exportPrTabPdf(sourceSheetId, cfg.pdf);
      pdfLink = await safeUploadPdfToDrive(pdfBuffer, `${prNoFormatted} - ${tab}.pdf`, PR_PDF_DRIVE_FOLDER_ID);
    } catch (e) { console.error('[pr-creation] PDF export failed:', e.message); }

    // 5) Log this PR so the ERP can list it — the sheet is still the database,
    // this is just another tab in it, same pattern as PO Creation's own log.
    const sessUser = req.session?.user;
    // "Form JSON" is appended at the end (not inserted mid-row) so existing
    // logged rows' column positions stay valid — same discipline as PO Log's
    // "PR No" column. It's a full snapshot of every field the create form
    // needs, used by PO Creation's P.R. NO picker (item detail only): the
    // live template tab only ever reflects the MOST RECENT submission for
    // that format, so anything not captured here is unrecoverable once a
    // later PR overwrites it.
    // "Status" is likewise appended at the end — defaults to "Active"; PR
    // Summary's "Cancel" action flips it to "Cancelled" in place (see PUT
    // /api/pr-creation/cancel below), which also excludes it from PO
    // Creation's pending-PR picker.
    await ensureLogTab(PR_CREATION_SHEET_ID, PR_CREATION_LOG_TAB, ['PR No', 'Format', 'Date', 'Vendor/Party', 'Requested By', 'Department', 'Total Amount (INR)', 'PDF Link', 'Created By', 'Created At', 'Form JSON', 'Status']);
    await appendLogRow(PR_CREATION_SHEET_ID, PR_CREATION_LOG_TAB, [
      // Leading "'" forces the ISO date to stay literal text instead of being
      // reparsed into a Sheets date value — same convention as ERP PO/GRN/PI
      // Log. Without it Sheets stored a serial number, which the log's own
      // plain-number column format then handed straight back to the PR Summary
      // table as "46246" (see _sheetDateToIso, which repairs the rows written
      // before this was quoted).
      prNoFormatted, tab, dateRequested ? "'" + dateRequested : '', party, requestedBy, departmentOut, totalAmount ?? '', pdfLink || '', sessUser?.name || '', _timestampForSheet(),
      JSON.stringify({ format: req.body.format, requestedBy, vendorName, partyName, personWhoRaisedPr, orderNo, department, termsOfPayment, estimatedDelDate, dateRequested, items: cleanItems }),
      'Active',
    ]);

    // 6) Also drop a row into "PR Form Responses" (RM_1_res) — see
    // PR_MONITORING_SHEET_ID above for why this, not "FMS (Stores)". Column
    // order matches that sheet's own header row exactly: Timestamp, PR No,
    // Name, Vendor, If New Vendor, Department, If New Department, then 6
    // category "Product Name" columns left blank (see constant comment), and
    // the archived PDF's Drive link in the sheet's existing "PDF link" column
    // (V — see PR_MONITORING_PDF_COL for why not U). append() fills from
    // column A, so every cell before it is padded explicitly: omitting them
    // would slide the link left into a column that isn't ours. That padding
    // also covers U, whose blank leaves the Apps Script's Mail_Sent cell for
    // the script itself to stamp.
    // Best-effort and last: a failure here must never undo/block the PR
    // itself, which is already fully created at this point.
    try {
      const row = [
        _timestampForSheet(), prNoFormatted, requestedBy, party, '', departmentOut, '',
      ];
      while (row.length < PR_MONITORING_PDF_PAD) row.push('');
      row.push(pdfLink || '');
      await appendLogRow(PR_MONITORING_SHEET_ID, PR_MONITORING_TAB_NAME, row);
      console.log('[pr-creation] PR Form Responses sync: row appended for', prNoFormatted, '| PDF link:', pdfLink ? 'yes' : 'none');
    } catch (e) { console.error('[pr-creation] PR Form Responses sync failed:', e.message); }

    return res.json({ success: true, prNumber: prNoFormatted, totalAmount, department: departmentOut, pdfLink });
  } catch (e) { console.error('[pr-creation] failed:', e.message); return res.status(500).json({ error: e.message }); }
});

// GET /api/pr-creation/list — recent PRs created via the ERP, read straight
// from the "ERP PR Log" tab (most recent first).
app.get('/api/pr-creation/list', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({ spreadsheetId: PR_CREATION_SHEET_ID, range: `'${PR_CREATION_LOG_TAB}'!A2:L1000`, valueRenderOption: 'FORMATTED_VALUE' });
    const rows = (result.data.values || []).filter(r => r[0]).map(r => {
      let form = null;
      try { form = JSON.parse(r[10] || 'null'); } catch { form = null; }
      return {
        prNo: r[0] || '', format: r[1] || '', date: _sheetDateToIso(r[2]), party: r[3] || '', requestedBy: r[4] || '',
        department: r[5] || '', total: r[6] || '', pdfLink: r[7] || '', createdBy: r[8] || '', createdAt: r[9] || '', form,
        status: r[11] || 'Active',
      };
    }).reverse();
    return res.json(rows.slice(0, 200));
  } catch (e) {
    // No PR has been created via the ERP yet — the log tab doesn't exist.
    if (/unable to parse range/i.test(e.message || '')) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// PUT /api/pr-creation/cancel?prNo=... — marks that PR's row Cancelled in
// "ERP PR Log" (column L) instead of deleting it: the row stays for history/
// audit, but drops out of PO Creation's pending-PR picker. The archived PDF
// in Drive and the PR's own number are both untouched/not freed for reuse.
app.put('/api/pr-creation/cancel', requireAuth, async (req, res) => {
  try {
    const prNo = req.query.prNo;
    if (!prNo) return res.status(400).json({ error: 'prNo is required' });
    await _setLogRowStatus(PR_CREATION_SHEET_ID, PR_CREATION_LOG_TAB, prNo, 'L', 'Cancelled');
    return res.json({ success: true });
  } catch (e) { return res.status(e.notFound ? 404 : 500).json({ error: e.message }); }
});

// Owner-only — see SUPER_ADMIN_EMAIL.
app.delete('/api/pr-creation', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const prNo = req.query.prNo;
    if (!prNo) return res.status(400).json({ error: 'prNo is required' });
    await _deleteLogRowByKey(PR_CREATION_SHEET_ID, PR_CREATION_LOG_TAB, prNo);
    return res.json({ success: true });
  } catch (e) { return res.status(e.notFound ? 404 : 500).json({ error: e.message }); }
});

// ── PO Pending (read-only report over the store team's approval FMS) ──────
// The PR→PO approval chain does NOT live in this app: it lives in the "FMS
// (Stores)" workbook's "Monitoring" tab, where each of the 12 steps below is
// its own Google Form. Every step block is a fixed column range holding a
// Planned Time / Actual Time pair — a blank Actual Time IS the pending state,
// which is what this endpoint reports on. Nothing here ever writes.
const FMS_MONITORING_SHEET_ID = '1J-JxWsTmWPm8v1QwkkQQCv29Xw6dmxajj1fIVoybfzQ';
const FMS_MONITORING_TAB = 'Monitoring';

// Column indexes reverse-engineered from the live tab's two header rows
// (row 1 = step banner + owner, row 3 = per-field labels; data starts row 4).
//
// Two blocks do NOT match their own header row and must stay as written:
//  - S4B's form writes the approver's name into col 54 (the column labelled
//    "PR No.") and the approval into 57 (labelled 58), so this block has no
//    usable PR column at all — hence prCol: null.
//  - S7 has "PR. No" at 90 and "Actual Time" at 91, i.e. the reverse of every
//    other block's planned/actual/PR ordering.
const FMS_PO_STEPS = [
  { key: 'S1',  label: 'PR Generation',          owner: 'Sagar',                      planned: null, actual: 0,   prCol: 1 },
  { key: 'S2',  label: 'Factory Manager Approval', owner: 'Khurshid Alam',            planned: 21,  actual: 22,  prCol: 23,  by: 24,  approval: 25, timeline: 27 },
  { key: 'S3',  label: 'Manager Approval',       owner: 'Kannu Sir',                  planned: 29,  actual: 30,  prCol: 31,  by: 32,  approval: 33, timeline: 35 },
  { key: 'S4A', label: 'Quotations Giving',      owner: 'Sagar',                      planned: 37,  actual: 38,  prCol: 39,  by: 40,  timeline: 50 },
  { key: 'S4B', label: 'Quotations Approval',    owner: 'Sajil Sir / Dhiren Sir',     planned: 52,  actual: 53,  prCol: null, by: 54, approval: 57, timeline: 59 },
  { key: 'S5',  label: 'Create PO',              owner: 'Khurshid / Sagar / Ashok',   planned: 61,  actual: 62,  prCol: 63,  by: 64,  approval: 65, poNo: 66, timeline: 68, poStep: true },
  // Not used in practice — the chain routinely completes past it with its
  // Actual Time left blank, so counting it would park every PR on a step
  // nobody is waiting for. Dropped from the report entirely; delete `ignored`
  // to bring it back.
  { key: 'S5B', label: 'PO Approval',            owner: 'Sajil Sir',                  planned: 70,  actual: 71,  prCol: 72,  by: 73,  approval: 74, poNo: 75, timeline: 77, poStep: true, ignored: true },
  { key: 'S6',  label: 'Issue PO to Vendor',     owner: 'Khurshid / Sagar / Ashok',   planned: 79,  actual: 80,  prCol: 81,  by: 83,  approval: 84, poNo: 82, timeline: 87, poStep: true },
  { key: 'S7',  label: 'Advance Payment',        owner: 'Sushil Sir',                 planned: 89,  actual: 91,  prCol: 90,  by: 93,  approval: 94, poNo: 92, timeline: 95 },
  { key: 'S8A', label: 'Goods Challan Filling',  owner: 'Sagar',                      planned: 97,  actual: 98,  prCol: 99,  by: 101, poNo: 100, timeline: 105 },
  { key: 'S8B', label: 'Goods Supervisor Form',  owner: 'Supervisors',                planned: 107, actual: 108, prCol: 109, by: 111, poNo: 110, timeline: 123 },
  { key: 'S9',  label: 'Accounts Checklist',     owner: 'Sagar',                      planned: 125, actual: 126, prCol: 127, by: 129, poNo: 128, timeline: 143 },
];

// The steps the report actually reasons about. Everything downstream —
// progress track, "pending at", bypassed detection, the bottleneck — walks
// this list, so an ignored step can never become the answer to "kahan atka
// hai" nor make a finished chain look unfinished.
const FMS_PO_STEPS_ACTIVE = FMS_PO_STEPS.filter(s => !s.ignored);

// Row 4 of the live sheet holds PR175's Step 1 but Step 9's response for
// PR172 — a step's Form appends to the next free row of its OWN block, which
// is not necessarily the row that step's PR started on. So a block whose PR
// column names a different PR than the row does is treated as belonging to
// that named PR, not to the row it physically sits on. Without this, PR175
// reads as "Accounts Checklist done" off a neighbour's data.
function _fmsBlockValue(row, step, field) {
  const c = step[field];
  return c == null ? '' : String((row || [])[c] ?? '').trim();
}

// Planned cells are a mix of dd/mm/yyyy text, raw Sheets serials (a Form that
// wrote a timestamp rather than a date) and literal "NA". Normalize to a
// display string plus a UTC ms value where one can be read.
function _fmsParseDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /^(na|n\/a|-+)$/i.test(s)) return { display: s === '' ? '' : s, ms: null };
  if (/^\d+(\.\d+)?$/.test(s)) {
    const ms = Date.UTC(1899, 11, 30) + Math.floor(parseFloat(s)) * 86400000;
    const d = new Date(ms);
    return { display: `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`, ms };
  }
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (m) return { display: s, ms: Date.UTC(+m[3], +m[2] - 1, +m[1]) };
  return { display: s, ms: null };
}

// One shared cache for all viewers: the page polls live, and three Sheets
// reads per viewer per poll would burn the per-minute read quota (already
// seen returning 429). On a fetch error the last good payload is served with
// stale:true rather than blanking the page.
let _fmsPendingCache = { at: 0, payload: null };
const FMS_PENDING_TTL_MS = 45000;

async function _buildFmsPoPending() {
  const auth = getGoogleAuth();
  if (!auth) throw new Error('Google Sheets is not configured on this server');
  const { google } = require('googleapis');
  const sheets = google.sheets({ version: 'v4', auth });

  const read = async (spreadsheetId, range) => {
    try {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'FORMATTED_VALUE' });
      return r.data.values || [];
    } catch (e) {
      if (/unable to parse range/i.test(e.message || '')) return [];
      throw e;
    }
  };

  const [monRows, erpPrRows, erpPoRows] = await Promise.all([
    read(FMS_MONITORING_SHEET_ID, `'${FMS_MONITORING_TAB}'!A1:EO1000`),
    read(PR_CREATION_SHEET_ID, `'${PR_CREATION_LOG_TAB}'!A2:L1000`),
    read(PO_CREATION_SHEET_ID, `'${PO_CREATION_LOG_TAB}'!A2:L1000`),
  ]);

  // Data starts at row 4 (index 3) — rows 1-3 are the two header bands.
  const dataRows = monRows.slice(3).map((r, i) => ({ r, sheetRow: i + 4 })).filter(x => String(x.r[1] ?? '').trim());

  // Pass 1: every block occurrence, tagged with the PR it names itself for.
  const claimed = new Map(); // `${prKey}|${stepKey}` -> block snapshot
  for (const { r } of monRows.slice(3).map((r, i) => ({ r, sheetRow: i + 4 }))) {
    for (const step of FMS_PO_STEPS_ACTIVE) {
      if (step.prCol == null) continue;
      const own = _normalizePrNo(_fmsBlockValue(r, step, 'prCol'));
      if (!own) continue;
      const actual = _fmsBlockValue(r, step, 'actual');
      if (!actual) continue;
      const k = `${own}|${step.key}`;
      if (!claimed.has(k)) {
        claimed.set(k, {
          actual, by: _fmsBlockValue(r, step, 'by'), approval: _fmsBlockValue(r, step, 'approval'),
          poNo: _fmsBlockValue(r, step, 'poNo'), timeline: _fmsBlockValue(r, step, 'timeline'),
        });
      }
    }
  }

  const todayMs = (() => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); })();

  // ERP PO Log, keyed by the PR it was raised against — lets the report show
  // the real PO number next to an FMS step that only records "PO Made: YES".
  const erpPoByPr = new Map();
  for (const r of erpPoRows) {
    if (!r[0] || (r[11] || 'Active') === 'Cancelled') continue;
    const k = _normalizePrNo(r[9]);
    if (k && !erpPoByPr.has(k)) erpPoByPr.set(k, { poNo: r[0], date: _sheetDateToIso(r[2]), party: r[3] || '', total: r[5] || '' });
  }

  const rows = dataRows.map(({ r, sheetRow }) => {
    const prNo = String(r[1] ?? '').trim();
    const prKey = _normalizePrNo(prNo);

    const steps = FMS_PO_STEPS_ACTIVE.map(step => {
      const own = step.prCol == null ? '' : _normalizePrNo(_fmsBlockValue(r, step, 'prCol'));
      // A block naming someone else is that PR's data parked on this row.
      const strayHere = !!own && own !== prKey;
      const mine = claimed.get(`${prKey}|${step.key}`);
      const inline = strayHere ? null : {
        actual: _fmsBlockValue(r, step, 'actual'), by: _fmsBlockValue(r, step, 'by'),
        approval: _fmsBlockValue(r, step, 'approval'), poNo: _fmsBlockValue(r, step, 'poNo'),
        timeline: _fmsBlockValue(r, step, 'timeline'),
      };
      const src = (inline && inline.actual) ? inline : (mine || inline || {});
      // Planned always comes off the PR's own row — it is written there when
      // the previous step completes, even if the response landed elsewhere.
      const planned = _fmsParseDate(step.planned == null ? '' : String(r[step.planned] ?? '').trim());
      const actual = _fmsParseDate(src.actual || '');
      return {
        key: step.key, label: step.label, owner: step.owner, poStep: !!step.poStep,
        done: !!actual.display, planned: planned.display, plannedMs: planned.ms,
        actual: actual.display, by: src.by || '', approval: src.approval || '',
        poNo: (src.poNo || '').replace(/^-+$/, ''), timeline: src.timeline || '',
      };
    });

    const firstOpen = steps.find(s => !s.done) || null;
    const lastDoneIdx = steps.reduce((acc, s, i) => (s.done ? i : acc), -1);
    // A blank step that has a completed step after it was never filled in —
    // the chain moved on without it (e.g. goods received against a PO whose
    // approval step is still empty).
    const bypassed = steps.filter((s, i) => !s.done && i < lastDoneIdx)
      .map(s => ({ key: s.key, label: s.label, owner: s.owner }));

    const pendingAt = firstOpen ? {
      key: firstOpen.key, label: firstOpen.label, owner: firstOpen.owner,
      planned: firstOpen.planned,
      daysLate: firstOpen.plannedMs == null ? null : Math.round((todayMs - firstOpen.plannedMs) / 86400000),
    } : null;

    const erpPo = erpPoByPr.get(prKey) || null;
    const fmsPoNo = (steps.find(s => s.poNo)?.poNo) || '';

    return {
      prNo, prKey, sheetRow,
      raisedOn: String(r[0] ?? '').trim(),
      requestedBy: String(r[2] ?? '').trim(),
      vendor: String(r[3] ?? '').trim() || String(r[4] ?? '').trim(),
      department: String(r[5] ?? '').trim() || String(r[6] ?? '').trim(),
      steps, pendingAt, bypassed,
      complete: !pendingAt,
      erpPoNo: erpPo?.poNo || '', erpPoDate: erpPo?.date || '', erpPoTotal: erpPo?.total || '',
      fmsPoNo,
      // The PO exists in the ERP but the FMS step that creates it was never
      // filled — the two systems disagree about where this PR actually is.
      poMismatch: !!erpPo && !steps.find(s => s.key === 'S5')?.done,
    };
  });

  // PRs the ERP knows about that never entered the approval chain at all.
  const inFms = new Set(rows.map(r => r.prKey));
  const notInFms = erpPrRows
    .filter(r => r[0] && (r[11] || 'Active') !== 'Cancelled' && !inFms.has(_normalizePrNo(r[0])))
    .map(r => {
      const k = _normalizePrNo(r[0]);
      const po = erpPoByPr.get(k);
      return { prNo: r[0], party: r[3] || '', requestedBy: r[4] || '', total: r[6] || '', poNo: po?.poNo || '' };
    })
    .reverse();

  const pending = rows.filter(r => r.pendingAt);
  const byStepMap = new Map();
  for (const r of pending) {
    const k = r.pendingAt.key;
    if (!byStepMap.has(k)) byStepMap.set(k, { key: k, label: r.pendingAt.label, owner: r.pendingAt.owner, count: 0, overdue: 0, prNos: [] });
    const e = byStepMap.get(k);
    e.count++; e.prNos.push(r.prNo);
    if (r.pendingAt.daysLate > 0) e.overdue++;
  }
  const byStep = FMS_PO_STEPS_ACTIVE.map(s => byStepMap.get(s.key)).filter(Boolean).sort((a, b) => b.count - a.count);

  return {
    fetchedAt: new Date().toISOString(),
    steps: FMS_PO_STEPS_ACTIVE.map(s => ({ key: s.key, label: s.label, owner: s.owner, poStep: !!s.poStep })),
    rows,
    notInFms,
    summary: {
      tracked: rows.length,
      complete: rows.filter(r => r.complete).length,
      pending: pending.length,
      overdue: pending.filter(r => r.pendingAt.daysLate > 0).length,
      atPoSteps: pending.filter(r => ['S5', 'S6'].includes(r.pendingAt.key)).length,
      bypassed: rows.filter(r => r.bypassed.length).length,
      mismatched: rows.filter(r => r.poMismatch).length,
      notInFms: notInFms.length,
      bottleneck: byStep[0] || null,
    },
    byStep,
  };
}

// GET /api/fms-po-pending?refresh=1 — where every tracked PR currently sits in
// the Stores approval FMS. Cached for FMS_PENDING_TTL_MS; ?refresh=1 forces a
// re-read (the page's manual Refresh button).
app.get('/api/fms-po-pending', requireAuth, async (req, res) => {
  const force = req.query.refresh === '1';
  const fresh = !force && _fmsPendingCache.payload && (Date.now() - _fmsPendingCache.at) < FMS_PENDING_TTL_MS;
  if (fresh) return res.json({ ..._fmsPendingCache.payload, cached: true });
  try {
    const payload = await _buildFmsPoPending();
    _fmsPendingCache = { at: Date.now(), payload };
    return res.json({ ...payload, cached: false });
  } catch (e) {
    if (_fmsPendingCache.payload) return res.json({ ..._fmsPendingCache.payload, cached: true, stale: true, error: e.message });
    return res.status(500).json({ error: e.message });
  }
});

// ── GRN Creation (same pattern as PO Creation above: fills the store team's
// live "GRN June 2026" Google Sheet directly — that sheet IS the database
// here too). The "GRN" tab is a single reusable template (no multi-format
// split like PO): submitting overwrites it in place, exports it as a PDF
// (Drive-hosted), and logs it in "ERP GRN Log" — the template stays put,
// ready for the next GRN.
const GRN_CREATION_SHEET_ID = '15io7qclrqbmm8j0xduBbHakVTLHYpe8UC3c_1RajWsk';
const GRN_CREATION_LOG_TAB = 'ERP GRN Log';
const GRN_TEMPLATE_TAB = 'GRN';

// Cell refs reverse-engineered from the live template (formula render + merge
// inspection, 2026-07-29; re-verified 2026-08-01 after Approved/Rejected Qty
// columns were added). Columns C:H on each item row are an ARRAYFORMULA
// spill anchored at C6:H6 (VLOOKUP against item_code by Item No.) — never
// write to them, they populate automatically once Item No. (B) is written.
//
// The user inserted 2 real columns at J/K in the live sheet (not appended
// after the formula) to hold Approved/Rejected Qty — Google Sheets shifted
// every column from J onward one row-height at a time across the WHOLE
// sheet (not just the item rows), and auto-updated every formula reference
// to match. Verified live: old J(UOM)/K(Rate)/L(=I*K totals formula) are now
// L/M/N — confirmed by the per-row total formula reading "=I26*M26" and the
// summary block's "=SUM(N7:N26)" / "=SUM(N27:N30)", and confirmed working end
// to end on a real generated GRN PDF (Subtotal/CGST/SGST/RoundOff/Total all
// printed correctly). Column N is that real per-row/summary formula chain —
// never write to it, clearing it would delete the formula for good. The
// clear step below only ever touches B (item no.) and I:M (received qty/
// approved qty/rejected qty/uom/rate), which are now conveniently contiguous.
//
// The header row's Date cell is a special case: it's a MERGED cell (M4:N4,
// confirmed via spreadsheets.get's `merges`), and Google Sheets only ever
// displays/accepts a write on a merge's anchor (top-left) cell — N4 silently
// wrote nothing. Its real write target is M4, the merge anchor (found by
// checking `merges` after a real GRN's Date came out blank on the printed
// PDF — the plain per-row formula shift logic above does NOT apply to
// merged header cells, don't assume one from the other again).
//
// The sheet's own "vendor details" / "item_code" tabs are IMPORTRANGE
// pull-throughs of PR_SHEET_ID's "Vendor Name" tab and the PO sheet's
// ITEM_CODES tab respectively — IMPORTRANGE needs a one-time manual "Allow
// access" click in the Sheets UI that a service account can't grant itself,
// and at inspection time neither had been authorized (#REF! on both). Masters
// below read straight from those two source sheets instead, sidestepping the
// dependency entirely — the item catalog literally reuses PO Creation's own
// _loadPoItemCatalog('PurchaseOrder') cache since it's the exact same range.
const GRN_HEADER_CELLS = {
  grNo: 'B4', madeBy: 'C4', prNo: 'D4', vendorName: 'E4', poNo: 'F4',
  billNo: 'G4', billRecvDate: 'H4', deptHead: 'I4', date: 'M4',
};
// Column I keeps its original meaning of "how many units this row is about"
// but is now Received Qty specifically, now that Approved (J) and Rejected
// (K) are tracked separately — see the column-shift comment above for why
// UOM/Rate ended up at L/M instead of staying at J/K.
const GRN_ITEMS = { firstRow: 7, lastRow: 26, itemNoCol: 'B', qtyCol: 'I', approvedQtyCol: 'J', rejectedQtyCol: 'K', uomCol: 'L', rateCol: 'M' };
const GRN_SUMMARY_CELLS = { cgst: 'N28', sgst: 'N29', roundOff: 'N30' };
const GRN_COMMENTS_CELL = 'B28';
const GRN_SUBTOTAL_CELL = 'N27';
const GRN_TOTAL_CELL = 'N31';

async function _grnSheetMeta() {
  const auth = getGoogleAuth();
  const { google } = require('googleapis');
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: GRN_CREATION_SHEET_ID });
  const sheetIdByTitle = {};
  let maxGrNo = 0;
  for (const s of meta.data.sheets) {
    sheetIdByTitle[s.properties.title] = s.properties.sheetId;
    // Legacy archive tabs — no new ones get created since PDF export replaced
    // tab-duplication, so this alone would freeze nextGrNo forever. The real,
    // growing sequence lives in ERP GRN Log's own GR No column (read below).
    const m = /^GR\s+(\d+)$/i.exec(s.properties.title.trim());
    if (m) maxGrNo = Math.max(maxGrNo, parseInt(m[1], 10));
  }
  try {
    const logRes = await sheets.spreadsheets.values.get({ spreadsheetId: GRN_CREATION_SHEET_ID, range: `'${GRN_CREATION_LOG_TAB}'!A2:A`, valueRenderOption: 'UNFORMATTED_VALUE' });
    for (const row of (logRes.data.values || [])) {
      const n = parseInt(row[0], 10);
      if (!isNaN(n)) maxGrNo = Math.max(maxGrNo, n);
    }
  } catch (e) {
    if (!/unable to parse range/i.test(e.message || '')) console.error('[grn-creation] log read for numbering failed:', e.message);
  }
  return { nextGrNo: maxGrNo + 1, sheetIdByTitle };
}

// GET /api/grn-creation/masters — vendor list (from PR_SHEET_ID's "Vendor
// Name" tab, the same source the GRN sheet's own broken IMPORTRANGE points
// at) and the next GR number, read live (no local mirror).
app.get('/api/grn-creation/masters', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const [vendorsRes, meta] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: PR_SHEET_ID, range: `'Vendor Name'!A3:A2000`, valueRenderOption: 'FORMATTED_VALUE' }),
      _grnSheetMeta(),
    ]);
    const vendors = (vendorsRes.data.values || []).filter(r => r[0]).map(r => r[0]);
    return res.json({ vendors, nextGrNumber: meta.nextGrNo });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// GET /api/grn-creation/po-list — POs (from PO Creation's own "ERP PO Log")
// that haven't been used on any GRN yet, for the PO No. field's suggestion
// dropdown. "Pending" = its PO No doesn't appear in the PO No column GRNs
// have already logged against, and it isn't Cancelled — same one-PO-per-GRN
// discipline as PO Creation's own pending-PR filter. Each PO already carries
// its own PR No (logged when the PO was created), so GRN gets that for free
// instead of needing its own PR lookup.
app.get('/api/grn-creation/po-list', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    let poRows = [];
    try {
      const poRes = await sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range: `'${PO_CREATION_LOG_TAB}'!A2:L1000`, valueRenderOption: 'FORMATTED_VALUE' });
      poRows = poRes.data.values || [];
    } catch (e) {
      if (!/unable to parse range/i.test(e.message || '')) throw e;
    }
    let usedPoNos = new Set();
    try {
      const grnRes = await sheets.spreadsheets.values.get({ spreadsheetId: GRN_CREATION_SHEET_ID, range: `'${GRN_CREATION_LOG_TAB}'!F2:F1000`, valueRenderOption: 'FORMATTED_VALUE' });
      usedPoNos = new Set((grnRes.data.values || []).map(r => _seqKey(r[0])).filter(Boolean));
    } catch (e) {
      if (!/unable to parse range/i.test(e.message || '')) throw e;
    }
    // Service POs are excluded outright (column B / r[1]): there's nothing
    // physical to receive against a service, so they'd only ever be noise in
    // this picker. They still appear in PO Creation's own PO List.
    const list = poRows
      .filter(r => r[0] && r[1] !== 'Service PO' && (r[11] || 'Active') !== 'Cancelled' && !usedPoNos.has(_seqKey(r[0])))
      .map(r => {
        let items = [];
        try { items = JSON.parse(r[10] || 'null')?.items || []; } catch { items = []; }
        return { poNo: r[0] || '', format: r[1] || '', party: r[3] || '', department: r[4] || '', prNo: r[9] || '', vendorName: r[3] || '', items };
      })
      .reverse();
    return res.json(list.slice(0, 200));
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// GET /api/grn-creation/items?q=... — item-no typeahead. Reuses PO
// Creation's own item catalog cache (_loadPoItemCatalog) since the GRN
// sheet's item_code tab is an IMPORTRANGE of the exact same PO ITEM_CODES
// range — no separate cache needed.
app.get('/api/grn-creation/items', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = await _loadPoItemCatalog('PurchaseOrder');
    // No cap — see the matching comment on /api/po-creation/items above.
    const matches = q ? rows.filter(r => r.code.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) : rows;
    return res.json(matches);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// POST /api/grn-creation — fills the live "GRN" template tab, exports it as a
// PDF (saved to Drive), and logs it in "ERP GRN Log". This IS the database
// write; nothing is stored locally.
app.post('/api/grn-creation', requireAuth, async (req, res) => {
  try {
    const { date, madeBy, prNo, vendorName, poNo, billNo, billRecvDate, deptHead, items, cgst, sgst, roundOff, comments } = req.body;
    if (!date || !vendorName || !madeBy) return res.status(400).json({ error: 'Date, Vendor Name and Made By are required' });
    const cleanItems = (Array.isArray(items) ? items : []).filter(it => it && String(it.itemNo || '').trim());
    if (!cleanItems.length) return res.status(400).json({ error: 'Add at least one item' });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    const { nextGrNo, sheetIdByTitle } = await _grnSheetMeta();
    const tab = GRN_TEMPLATE_TAB;
    const sourceSheetId = sheetIdByTitle[tab];
    if (sourceSheetId === undefined) return res.status(500).json({ error: `Template tab "${tab}" not found in the GRN sheet` });

    // 1) Clear the previous GRN's item rows so nothing from it bleeds into
    // this one — only the manual columns (see comment on GRN_ITEMS above).
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: GRN_CREATION_SHEET_ID,
      requestBody: { ranges: [
        `'${tab}'!${GRN_ITEMS.itemNoCol}${GRN_ITEMS.firstRow}:${GRN_ITEMS.itemNoCol}${GRN_ITEMS.lastRow}`,
        // I:M is one contiguous block (received/approved/rejected qty, uom,
        // rate) now that Approved/Rejected sit between qty and uom/rate —
        // see the GRN_ITEMS comment above. N (the totals formula) is never
        // touched.
        `'${tab}'!${GRN_ITEMS.qtyCol}${GRN_ITEMS.firstRow}:${GRN_ITEMS.rateCol}${GRN_ITEMS.lastRow}`,
      ] },
    });

    // 2) Write header fields, item rows, and CGST/SGST/Round Off in one
    // batch. The summary fields are always written — even when 0 — since
    // they feed the sheet's own Total formula and must never carry over a
    // previous GRN's numbers. Comments is likewise always written (possibly
    // blank) so a previous GRN's note can't linger on this one.
    const data = [];
    const put = (a1, value) => { if (value !== undefined && value !== null && value !== '') data.push({ range: `'${tab}'!${a1}`, values: [[value]] }); };
    put(GRN_HEADER_CELLS.grNo, nextGrNo);
    put(GRN_HEADER_CELLS.madeBy, madeBy);
    put(GRN_HEADER_CELLS.prNo, prNo);
    put(GRN_HEADER_CELLS.vendorName, vendorName);
    put(GRN_HEADER_CELLS.poNo, poNo);
    put(GRN_HEADER_CELLS.billNo, billNo);
    put(GRN_HEADER_CELLS.billRecvDate, billRecvDate);
    put(GRN_HEADER_CELLS.deptHead, deptHead);
    put(GRN_HEADER_CELLS.date, date);
    data.push({ range: `'${tab}'!${GRN_COMMENTS_CELL}`, values: [[comments || '']] });
    data.push({ range: `'${tab}'!${GRN_SUMMARY_CELLS.cgst}`, values: [[parseFloat(cgst) || 0]] });
    data.push({ range: `'${tab}'!${GRN_SUMMARY_CELLS.sgst}`, values: [[parseFloat(sgst) || 0]] });
    data.push({ range: `'${tab}'!${GRN_SUMMARY_CELLS.roundOff}`, values: [[parseFloat(roundOff) || 0]] });

    cleanItems.forEach((it, i) => {
      const row = GRN_ITEMS.firstRow + i;
      if (row > GRN_ITEMS.lastRow) return; // beyond the template's own capacity — drop silently
      put(`${GRN_ITEMS.itemNoCol}${row}`, it.itemNo);
      put(`${GRN_ITEMS.qtyCol}${row}`, it.receivedQty);
      put(`${GRN_ITEMS.uomCol}${row}`, it.uom);
      put(`${GRN_ITEMS.rateCol}${row}`, it.rate);
      put(`${GRN_ITEMS.approvedQtyCol}${row}`, it.approvedQty);
      put(`${GRN_ITEMS.rejectedQtyCol}${row}`, it.rejectedQty);
    });

    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: GRN_CREATION_SHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      });
    }

    // A write is already fully recalculated internally, but both the very
    // next values.get (the Subtotal/Total read-back below) and the PDF
    // export can otherwise catch the sheet mid-recalculation and see
    // stale/blank formula results — this single pause covers both.
    await _sleep(2000);

    // 3) Read back the sheet's own computed Subtotal/Total (single source of
    // truth — never recompute the formula's math server-side).
    let subtotal = null, totalAmount = null;
    try {
      const totalsRes = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: GRN_CREATION_SHEET_ID,
        ranges: [`'${tab}'!${GRN_SUBTOTAL_CELL}`, `'${tab}'!${GRN_TOTAL_CELL}`],
        valueRenderOption: 'UNFORMATTED_VALUE',
      });
      subtotal = totalsRes.data.valueRanges?.[0]?.values?.[0]?.[0] ?? null;
      totalAmount = totalsRes.data.valueRanges?.[1]?.values?.[0]?.[0] ?? null;
    } catch (e) { console.error('[grn-creation] total read-back failed:', e.message); }

    // 4) Export this fill as a PDF and save it to Drive. A PDF/Drive hiccup
    // must never block the GRN itself from being created.
    let pdfLink = null;
    try {
      // Columns A:N (0-13) — the GRN tab's grid is 34 columns wide but the
      // template only uses the first 14; see _exportSheetTabPdf's comment.
      const pdfBuffer = await _exportSheetTabPdf(GRN_CREATION_SHEET_ID, sourceSheetId, { c1: 0, c2: 14 });
      pdfLink = await safeUploadPdfToDrive(pdfBuffer, `GR ${nextGrNo}.pdf`, GRN_PDF_DRIVE_FOLDER_ID);
    } catch (e) { console.error('[grn-creation] PDF export failed:', e.message); }

    // 5) Log this GRN so the ERP can list it — same pattern as "ERP PO Log".
    const sessUser = req.session?.user;
    // "Form JSON" is appended at the end so existing rows' column positions
    // stay valid — same discipline as PO/PR Log. It's the only other place a
    // past GRN's items are recoverable from, since the live template tab
    // only ever reflects the most recent submission.
    // "Status" is likewise appended at the end — defaults to "Active"; GRN
    // List's "Cancel" action flips it to "Cancelled" in place (see PUT
    // /api/grn-creation/cancel below).
    await ensureLogTab(GRN_CREATION_SHEET_ID, GRN_CREATION_LOG_TAB, ['GR No', 'Date', 'Made By', 'PR No', 'Vendor Name', 'PO No', 'Bill No', 'Total Amount (INR)', 'PDF Link', 'Created By', 'Created At', 'Form JSON', 'Status']);
    await appendLogRow(GRN_CREATION_SHEET_ID, GRN_CREATION_LOG_TAB, [
      // Leading "'" forces the ISO date to stay literal text instead of being
      // reparsed into a locale-formatted date — same convention as ERP PO Log.
      nextGrNo, "'" + date, madeBy, prNo || '', vendorName, poNo || '', billNo || '', totalAmount ?? '', pdfLink || '', sessUser?.name || '', _timestampForSheet(),
      JSON.stringify({ date, madeBy, prNo, vendorName, poNo, billNo, billRecvDate, deptHead, comments, cgst, sgst, roundOff, items: cleanItems }),
      'Active',
    ]);

    return res.json({ success: true, grNumber: nextGrNo, subtotal, totalAmount, pdfLink });
  } catch (e) { console.error('[grn-creation] failed:', e.message); return res.status(500).json({ error: e.message }); }
});

// GET /api/grn-creation/list — recent GRNs created via the ERP, read straight
// from the "ERP GRN Log" tab (most recent first).
app.get('/api/grn-creation/list', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({ spreadsheetId: GRN_CREATION_SHEET_ID, range: `'${GRN_CREATION_LOG_TAB}'!A2:M1000`, valueRenderOption: 'FORMATTED_VALUE' });
    const rows = (result.data.values || []).filter(r => r[0]).map(r => {
      let form = null;
      try { form = JSON.parse(r[11] || 'null'); } catch { form = null; }
      return {
        grNo: r[0] || '', date: _sheetDateToIso(r[1]), madeBy: r[2] || '', prNo: r[3] || '', vendorName: r[4] || '',
        poNo: r[5] || '', billNo: r[6] || '', total: r[7] || '', pdfLink: r[8] || '', createdBy: r[9] || '', createdAt: r[10] || '', form,
        status: r[12] || 'Active',
      };
    }).reverse();
    return res.json(rows.slice(0, 200));
  } catch (e) {
    // No GRN has been created via the ERP yet — the log tab doesn't exist.
    if (/unable to parse range/i.test(e.message || '')) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// PUT /api/grn-creation/cancel?grNo=... — marks that GRN's row Cancelled in
// "ERP GRN Log" (column M) instead of deleting it: the row stays for
// history/audit. The archived PDF in Drive and the GRN's own number are both
// untouched/not freed for reuse.
app.put('/api/grn-creation/cancel', requireAuth, async (req, res) => {
  try {
    const grNo = req.query.grNo;
    if (!grNo) return res.status(400).json({ error: 'grNo is required' });
    await _setLogRowStatus(GRN_CREATION_SHEET_ID, GRN_CREATION_LOG_TAB, grNo, 'M', 'Cancelled');
    return res.json({ success: true });
  } catch (e) { return res.status(e.notFound ? 404 : 500).json({ error: e.message }); }
});

// Owner-only — see SUPER_ADMIN_EMAIL.
app.delete('/api/grn-creation', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const grNo = req.query.grNo;
    if (!grNo) return res.status(400).json({ error: 'grNo is required' });
    await _deleteLogRowByKey(GRN_CREATION_SHEET_ID, GRN_CREATION_LOG_TAB, grNo);
    return res.json({ success: true });
  } catch (e) { return res.status(e.notFound ? 404 : 500).json({ error: e.message }); }
});

// ── Proforma Invoice (PI) Creation — a brand-new, dedicated Google Sheet
// ("ERP - Proforma Invoice", created by scripts/create-pi-sheet.js) with the
// same "sheet IS the database" shape PO/PR/GRN use, but with one deliberate
// difference: this is a genuine TWO-STAGE record. A regular User creates the
// PI (buyer + items + qty — no price at all, not even accepted server-side).
// Later, whoever is granted the 'set_price' feature for this page (Admin/HOD
// always; a specific User only if explicitly granted via Users → Access tab)
// opens the SAME PI and fills in Rate/GST/Freight — this re-fills the
// template tab, regenerates the PDF, and updates the SAME log row in place
// (see _updateLogRowCells) rather than appending a new one. PO/PR/GRN never
// needed a true in-place edit — only a Status flip (Cancel) — so this is new.
const PI_CREATION_SHEET_ID = '1jWRILcYuJZh6EyxvOYz_Ol0z9X2X79RcDiKFV8x76XA';
const PI_CREATION_LOG_TAB = 'ERP PI Log';
const PI_TEMPLATE_TAB = 'Proforma Invoice';
const PI_PDF_DRIVE_FOLDER_ID = '1i693XlvXIlS8Ep1p4NJhkxolTCNE47qs';

// The PI is an EXPORT document — the company's real "Proforma Invoice / Order
// Confirmation Sheet (OCS)": letterhead, consignee + shipping blocks, an item
// table priced in C&F US$ (no GST/HSN — those belong to a domestic invoice),
// amount in words, boilerplate T&C and a two-sided acceptance signature.
//
// The layout (every row number, every cell, the boilerplate text) lives in
// backend/lib/pi-format.js, which scripts/rebuild-pi-sheet.js also reads when
// it paints the template tab. That shared module is why this cell map cannot
// drift from the sheet — unlike PO's map, which was reverse-engineered.
// Column L (Amount) and the totals row are live sheet formulas: cleared
// around, never written over.
const PI_FMT = require('./backend/lib/pi-format.js');
const PI_NO_PREFIX = 'VTV';   // Vatva works — the real "VTV/052/25-26" series
const PI_LOG_HEADER = ['PI No', 'Date', 'Buyer', 'Total C&F (US$)', 'PDF Link', 'Created By', 'Created At', 'Priced By', 'Priced At', 'Form JSON', 'Status'];

// Indian financial year label for a PI date — "25-26" for 1 Apr 2025 through
// 31 Mar 2026. The printed number restarts every FY, so the sequence alone is
// not unique; "VTV/052/25-26" as a whole is, and that whole string is the log
// row's key.
function _piFyLabel(dateStr) {
  const d = new Date(dateStr);
  const dt = isNaN(d.getTime()) ? new Date() : d;
  const startYear = dt.getMonth() >= 3 ? dt.getFullYear() : dt.getFullYear() - 1;  // April = month 3
  return String(startYear % 100).padStart(2, '0') + '-' + String((startYear + 1) % 100).padStart(2, '0');
}

function _piNoFormat(seq, fy) {
  return `${PI_NO_PREFIX}/${String(seq).padStart(3, '0')}/${fy}`;
}

// Reads the sequence out of either the current "VTV/052/25-26" form or the
// legacy "PI052" one the old domestic template used, so numbering keeps
// climbing across the format change instead of restarting at 1 mid-year.
// Current-form numbers only count toward their OWN financial year.
// A revision shares its parent's sequence — "VTV/052/25-26 R1" is still PI 52,
// so it must neither push the next new PI to 53 twice nor be read as a number
// of its own.
function _piSeqOf(raw, fy) {
  const s = String(raw ?? '').trim();
  const m = /^[A-Za-z]+\/(\d+)\/(\d{2}-\d{2})(?:\s+R\d+)?$/i.exec(s);
  if (m) return m[2] === fy ? parseInt(m[1], 10) : 0;
  const legacy = parseInt(s.replace(/^[A-Za-z]+/, ''), 10);
  return isNaN(legacy) ? 0 : legacy;
}

// A buyer who asks for changes gets the SAME PI amended, not a second
// unrelated offer — so a revision keeps the number and adds R1, R2, …
// ("VTV/052/25-26 R1"). The parent row is marked Superseded and keeps its own
// PDF, so what was originally offered stays provable.
const _PI_REV_RE = /^(.*?)\s+R(\d+)$/i;
function _piBaseNo(piNo) {
  const m = _PI_REV_RE.exec(String(piNo ?? '').trim());
  return m ? m[1].trim() : String(piNo ?? '').trim();
}
function _piRevNo(piNo) {
  const m = _PI_REV_RE.exec(String(piNo ?? '').trim());
  return m ? parseInt(m[2], 10) : 0;
}

// dd.mm.yyyy, the form the buyer's copy has always used. Written as text (see
// the leading apostrophe at the call site) so Sheets doesn't re-interpret it
// against the spreadsheet's own locale.
function _piDisplayDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(dateStr || '');
}

/* ── amount in words (US$) ─────────────────────────────────────────────
   International scale (thousand / million / billion), NOT the lakh-crore
   scale the rest of this app uses for INR — this line is read by the
   overseas buyer. */
const _PI_ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const _PI_TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function _piWordsUnder1000(n) {
  const parts = [];
  if (n >= 100) { parts.push(_PI_ONES[Math.floor(n / 100)], 'HUNDRED'); n %= 100; }
  if (n >= 20) { parts.push(_PI_TENS[Math.floor(n / 10)]); n %= 10; }
  if (n > 0) parts.push(_PI_ONES[n]);
  return parts.join(' ');
}

function _piWordsInt(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'ZERO';
  const scales = [[1e9, 'BILLION'], [1e6, 'MILLION'], [1e3, 'THOUSAND']];
  const parts = [];
  for (const [value, name] of scales) {
    if (n >= value) { parts.push(_piWordsUnder1000(Math.floor(n / value)), name); n %= value; }
  }
  if (n > 0) parts.push(_piWordsUnder1000(n));
  return parts.join(' ');
}

function _piAmountInWords(amount, labels) {
  const L = labels || PI_FMT.priceLabels();
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  const whole = Math.floor(n);
  const cents = Math.round((n - whole) * 100);
  let s = '(' + L.type + ' ' + L.words + ' ' + _piWordsInt(whole);
  if (cents > 0) s += ' AND ' + _piWordsInt(cents) + ' ' + L.subunit;
  return s + ' ONLY)';
}

// `fy` scopes the "next number" lookup to one financial year (see _piSeqOf).
async function _piSheetMeta(fy) {
  const auth = getGoogleAuth();
  const { google } = require('googleapis');
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: PI_CREATION_SHEET_ID });
  const tpl = meta.data.sheets.find(s => s.properties.title === PI_TEMPLATE_TAB);
  let maxSeq = 0;
  try {
    const logRes = await sheets.spreadsheets.values.get({ spreadsheetId: PI_CREATION_SHEET_ID, range: `'${PI_CREATION_LOG_TAB}'!A2:A`, valueRenderOption: 'FORMATTED_VALUE' });
    for (const row of (logRes.data.values || [])) maxSeq = Math.max(maxSeq, _piSeqOf(row[0], fy));
  } catch (e) {
    if (!/unable to parse range/i.test(e.message || '')) console.error('[proforma-invoice] log read for numbering failed:', e.message);
  }
  return { nextSeq: maxSeq + 1, templateSheetId: tpl ? tpl.properties.sheetId : 0 };
}

// Fills the (single, shared) template tab — used identically by create (rate
// left blank) and price-add (rate filled in), always as a FULL rewrite of the
// current PI, never a partial patch, since the tab only ever reflects the most
// recent write. Every mapped cell is written even when blank: a leftover value
// from the previous PI would otherwise print on this one.
// Opens the PI's row in the export team's follow-up tracker. Deliberately
// isolated from the PI write itself: the tracker is a separate workbook owned
// by another team, and it going down must never cost someone the PI they just
// filled in — the caller logs and carries on.
// First row of a tracker with nothing in any of its key columns. Scanning
// beats values.append here — five rows of WHO/HOW/WHEN process notes above the
// header row confuse append's idea of where the table starts. `keyOffsets` are
// indexes into the scanned block, which always starts at the timestamp column.
async function _firstFreeFmsRow(sheets, tracker, lastKeyCol, keyOffsets) {
  const used = await sheets.spreadsheets.values.get({
    spreadsheetId: tracker.spreadsheetId,
    range: `'${tracker.tab}'!${tracker.cols.timestamp}${tracker.firstDataRow}:${lastKeyCol}5000`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = used.data.values || [];
  let offset = rows.findIndex(r => keyOffsets.every(i => !String(r?.[i] ?? '').trim()));
  if (offset === -1) offset = rows.length;
  return tracker.firstDataRow + offset;
}

async function _appendPiFmsRow(sheets, entry) {
  const T = PI_FMT.FMS_TRACKER;
  const C = T.cols;
  const row = await _firstFreeFmsRow(sheets, T, C.piNo, [0, 1]);

  await sheets.spreadsheets.values.update({
    spreadsheetId: T.spreadsheetId,
    range: `'${T.tab}'!${C.timestamp}${row}:${C.piPdf}${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        _timestampForSheet(),
        "'" + entry.piNo,           // "VTV/052/25-26" — text, never a fraction
        entry.assignedTo || '',
        entry.customerName || '',
        entry.quantity || '',
        entry.targetDate || '',
        entry.pdfLink || '',
      ]],
    },
  });
  return row;
}

// Opens the order's row in the workbook's second flow, "Order to dispatch".
// Same isolation as the PI's own tracker row: a tracker that is down must
// never cost someone the Order Sheet they just raised, so the caller logs and
// carries on.
//
// Written as two ranges so the columns between them survive — see the note on
// OS_FMT.FMS_TRACKER.cols for what lives there.
async function _appendOrderFmsRow(sheets, entry) {
  const T = OS_FMT.FMS_TRACKER;
  const C = T.cols;
  const row = await _firstFreeFmsRow(sheets, T, C.orderNo, [0, 3]);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: T.spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `'${T.tab}'!${C.timestamp}${row}:${C.dueDate}${row}`,
          values: [[
            _timestampForSheet(),
            entry.customerName || '',
            entry.location || '',
            "'" + entry.orderNo,      // "VTV/ORD/001/26-27" — text, never a fraction
            entry.advanceDate || '',
            entry.dueDate || '',
          ]],
        },
        {
          range: `'${T.tab}'!${C.orderPdf}${row}:${C.piPdf}${row}`,
          values: [[entry.orderPdfLink || '', entry.piPdfLink || '']],
        },
      ],
    },
  });
  return row;
}

// A product photo URL becomes an =IMAGE() formula. Anything that isn't a bare
// http(s) URL is dropped rather than interpolated — the value goes into the
// sheet unescaped, so a stray quote would otherwise rewrite the formula.
function _piPhotoFormula(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\/[^"\s]+$/i.test(u)) return '';
  return `=IMAGE("${u}", 1)`;
}

// One item in four sizes is four lines but one product, and the buyer should
// see its picture once, not four times down the column. The product master
// backs this up: every one of the 85 multi-size items in fetch_product carries
// a single image URL across all of its size rows.
//
// So consecutive lines that are the same item AND the same photo become one
// photo group: the picture is written into the group's first row and the Photo
// cells are merged down it. Both halves of the key matter — matching on the
// photo alone would fuse two different products that happen to share a stock
// image, and on the name alone would hide a genuinely different picture. A
// line with no photo is always its own group, so nothing changes for those.
function _piPhotoGroups(items) {
  const groups = [];
  items.forEach((it, i) => {
    const photo = String(it.imageUrl || '').trim();
    const name = String(it.itemName || '').trim().toLowerCase();
    const prev = groups[groups.length - 1];
    if (prev && photo && prev.photo === photo && prev.name === name) { prev.count++; return; }
    groups.push({ start: i, count: 1, photo, name });
  });
  return groups;
}

// 'A' -> 0, 'N' -> 13. The PI's columns are all single letters, but the loop
// costs nothing and stops this being a trap if the table ever reaches AA.
function _piColIndex(letter) {
  return String(letter).toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

// Sheets reads a leading =, +, - or @ as the start of a formula, so a buyer
// contact like "+966 50 123 4567" lands on the printed page as #ERROR!.
// Anything written as text goes through here first; the apostrophe is a
// display-time marker Sheets strips, so the cell still reads back clean.
// Numbers are passed straight through — quoting them would make the sheet
// hold text where the totals row expects a figure to sum.
function _sheetText(v) {
  if (v == null) return '';
  if (typeof v === 'number') return v;
  const str = String(v);
  return /^[=+@-]/.test(str) ? "'" + str : str;
}

async function _fillPiTemplate(sheets, form, templateSheetId) {
  const tab = PI_TEMPLATE_TAB;
  const { LAYOUT: L, CELLS: C, ITEMS: IT, DEFAULTS: D } = PI_FMT;
  const items = form.items || [];

  // Two ranges, not one: the Amount column holds a per-row formula written
  // once by scripts/rebuild-pi-sheet.js, and clearing over it destroys it.
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: PI_CREATION_SHEET_ID,
    requestBody: { ranges: IT.clearRanges.map(([a, b]) => `'${tab}'!${a}${L.itemsFirstRow}:${b}${L.itemsLastRow}`) },
  });

  // Photo merges left behind by the PREVIOUS PI have to go before anything is
  // written: a value aimed at a cell swallowed by a merge never lands. Safe to
  // fire unconditionally — unmerging a range that holds no merges is a no-op,
  // and the template's other 54 merges are all outside this column.
  const canGroupPhotos = templateSheetId != null;
  const photoColIdx = _piColIndex(IT.photoCol);
  const itemRowsRange = {
    sheetId: templateSheetId,
    startRowIndex: L.itemsFirstRow - 1, endRowIndex: L.itemsLastRow,
    startColumnIndex: photoColIdx, endColumnIndex: photoColIdx + 1,
  };
  if (canGroupPhotos) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: PI_CREATION_SHEET_ID,
      requestBody: { requests: [{ unmergeCells: { range: itemRowsRange } }] },
    });
  }

  const capacity = L.itemsLastRow - L.itemsFirstRow + 1;
  const photoGroups = _piPhotoGroups(items.slice(0, capacity));
  // Without a sheet id there is nothing to merge into, so every line keeps its
  // own picture rather than losing three of four.
  const photoRows = new Set(canGroupPhotos ? photoGroups.map(g => g.start) : items.map((_, i) => i));

  const data = [];
  const putRaw = (a1, value) => data.push({ range: `'${tab}'!${a1}`, values: [[value ?? '']] });
  const put = (a1, value) => putRaw(a1, _sheetText(value));
  const putText = (a1, value) => putRaw(a1, value ? "'" + value : '');   // force text, never a parsed date/number

  putText(C.piNo, form.piNo);
  putText(C.date, _piDisplayDate(form.date));
  put(C.orderNo, form.orderNo);
  put(C.paymentTerms, form.paymentTerms);
  put(C.portOfLoading, form.portOfLoading);
  put(C.portOfDischarge, form.portOfDischarge);
  put(C.placeOfDelivery, form.placeOfDelivery);
  put(C.countryOfOrigin, form.countryOfOrigin);
  put(C.buyerName, form.buyerName);
  put(C.buyerTrn, form.buyerTrn);
  put(C.buyerAddress1, form.buyerAddress1);
  put(C.buyerAddress2, form.buyerAddress2);
  put(C.buyerContact, form.buyerContact);
  put(C.shipmentNote, form.shipmentNote);
  put(C.validityNote, PI_FMT.validityNote(form.validity));
  put(C.bankNote, D.bankNote);
  put(C.confirmLine, D.confirmLine);
  // Gulf buyers require the non-Israeli-origin declaration; everyone else
  // gets a blank line rather than an irrelevant one.
  put(C.declaration, form.includeDeclaration === false ? '' : D.declaration);
  put(C.acceptedBy, form.buyerName ? 'I Accept & By,   For, ' + form.buyerName : 'I Accept & By,');

  const terms = Array.isArray(form.terms) && form.terms.length ? form.terms : D.terms;
  for (let r = L.termsFirstRow; r <= L.termsLastRow; r++) put(`A${r}`, terms[r - L.termsFirstRow] || '');

  // The three money labels, rewritten from this PI's own price basis and
  // currency. The template is painted with the defaults, so a PI that has not
  // been priced yet (and every PI raised before these were selectable) reads
  // exactly as it always did.
  const money = PI_FMT.priceLabels(form.priceType, form.currency);
  put(`${IT.fields.rate}${L.itemHeaderRow}`, money.rateHeader);
  put(`${IT.amountCol}${L.itemHeaderRow}`, money.amountHeader);
  put(`${L.totalCapFirst}${L.wordsRow}`, money.totalCaption);

  items.forEach((it, i) => {
    const row = L.itemsFirstRow + i;
    if (row > L.itemsLastRow) return;   // beyond template capacity — see the cap enforced in POST
    put(`${IT.srNoCol}${row}`, i + 1);
    Object.entries(IT.fields).forEach(([field, col]) => put(`${col}${row}`, it[field]));
    put(`${IT.remarksCol}${row}`, it.remarks);
    // The product photo is a formula, not a value — Sheets has no way to place
    // a real image in a cell through the API. See LETTERHEAD.logoUrl for why
    // this resolves at all from a service account. An item with no photo gets
    // a blank cell rather than a broken =IMAGE(), and so does every line after
    // the first of a photo group — the merge below spreads the first one's
    // picture over all of them.
    putRaw(`${IT.photoCol}${row}`, photoRows.has(i) ? _piPhotoFormula(it.imageUrl) : '');
  });

  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: PI_CREATION_SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data } });

  // The template carries 30 item rows; a 1-item PI would otherwise print 29
  // empty ones and push the totals onto a second page. Hidden rows are left
  // out of the PDF export, so collapse the unused tail and re-show whatever
  // the previous PI had hidden.
  if (templateSheetId != null) {
    const firstIdx = L.itemsFirstRow - 1;
    const endIdx = L.itemsLastRow;
    const usedEnd = Math.min(firstIdx + Math.max(items.length, 1), endIdx);
    const rowRange = (startIndex, endIndex, hidden) => ({
      updateDimensionProperties: {
        range: { sheetId: templateSheetId, dimension: 'ROWS', startIndex, endIndex },
        properties: { hiddenByUser: hidden }, fields: 'hiddenByUser',
      },
    });
    const requests = [rowRange(firstIdx, usedEnd, false)];
    if (usedEnd < endIdx) requests.push(rowRange(usedEnd, endIdx, true));
    // Every used line gets the SAME height: sizing each row to its own content
    // left a merged pair sitting squashed beside full-height single lines, and
    // the table has to read as one block. A PI whose items carry no picture at
    // all still gets the compact height — there is nothing to make room for.
    //
    // A group's photo cell ends up taller than one row (2 sizes = 2x), but the
    // picture does not grow to match: the Photo column is 72px wide and
    // =IMAGE(url, 1) keeps the aspect ratio, so the image is width-limited and
    // simply centres in the taller cell.
    const rowPx = photoGroups.some(g => g.photo) ? L.itemRowHeightWithPhoto : L.itemRowHeight;
    const heights = items.slice(0, endIdx - firstIdx).map(() => rowPx);
    heights.forEach((px, i) => {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: templateSheetId, dimension: 'ROWS', startIndex: firstIdx + i, endIndex: firstIdx + i + 1 },
          properties: { pixelSize: px },
          fields: 'pixelSize',
        },
      });
    });

    // Working columns the buyer's copy leaves out (Total Weight). Re-applied
    // on every fill rather than baked into the template, so re-running
    // scripts/rebuild-pi-sheet.js cannot quietly put them back on the PDF.
    (IT.printHiddenCols || []).forEach(col => {
      const idx = _piColIndex(col);
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: templateSheetId, dimension: 'COLUMNS', startIndex: idx, endIndex: idx + 1 },
          properties: { hiddenByUser: true }, fields: 'hiddenByUser',
        },
      });
    });

    // One Photo cell per product, spanning that product's size lines.
    photoGroups.forEach(g => {
      if (g.count < 2) return;
      requests.push({
        mergeCells: {
          range: {
            sheetId: templateSheetId,
            startRowIndex: firstIdx + g.start, endRowIndex: firstIdx + g.start + g.count,
            startColumnIndex: photoColIdx, endColumnIndex: photoColIdx + 1,
          },
          mergeType: 'MERGE_ALL',
        },
      });
    });
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: PI_CREATION_SHEET_ID, requestBody: { requests } });
  }
}

// Shared post-write step for both create and price-add: wait for the sheet's
// formulas to settle, read back the computed Total, stamp the amount in words
// (which can only be built once that Total exists), then export + upload the
// PDF. Never lets a Drive/export hiccup block the actual data write.
async function _finishPiSubmission(sheets, piNoFormatted, templateSheetId, labels) {
  await _sleep(2000);
  let totalAmount = null;
  try {
    const totalRes = await sheets.spreadsheets.values.get({ spreadsheetId: PI_CREATION_SHEET_ID, range: `'${PI_TEMPLATE_TAB}'!${PI_FMT.TOTAL_CELL}`, valueRenderOption: 'UNFORMATTED_VALUE' });
    totalAmount = totalRes.data.values?.[0]?.[0] ?? null;
  } catch (e) { console.error('[proforma-invoice] total read-back failed:', e.message); }
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: PI_CREATION_SHEET_ID,
      range: `'${PI_TEMPLATE_TAB}'!${PI_FMT.CELLS.amountInWords}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[totalAmount ? _piAmountInWords(totalAmount, labels) : '']] },
    });
    await _sleep(600);
  } catch (e) { console.error('[proforma-invoice] amount-in-words write failed:', e.message); }
  let pdfLink = null;
  try {
    // Portrait, like every other document this app prints. The 14-column table
    // is wider than an A4 portrait page, but scale=4 ("fit to page") shrinks it
    // to fit, and it costs almost nothing: landscape was ALREADY being scaled
    // to 73.7% because the invoice is taller than a landscape page is deep, so
    // portrait's 68.3% is only ~7% smaller on the page — and it fills the sheet
    // rather than leaving a deep band of white below the signatures.
    const pdfBuffer = await _exportSheetTabPdf(PI_CREATION_SHEET_ID, templateSheetId, {
      c1: 0, c2: PI_FMT.LAYOUT.colCount, r1: 0, r2: PI_FMT.LAYOUT.lastRow, portrait: true, scale: 4,
    });
    // "VTV/052/25-26" has slashes in it — a Drive filename must not.
    pdfLink = await safeUploadPdfToDrive(pdfBuffer, `${piNoFormatted.replace(/\//g, '-')} - Proforma Invoice.pdf`, PI_PDF_DRIVE_FOLDER_ID);
  } catch (e) { console.error('[proforma-invoice] PDF export failed:', e.message); }
  return { totalAmount, pdfLink };
}

// The consignee master behind the create form's Consignee Name typeahead —
// the export team's own fetch_consignee tab (see CONSIGNEE_SOURCE in
// backend/lib/pi-format.js). This app has no Buyer/Customer master of its own,
// and every one of these buyers' address, phone, ports and place of delivery
// was otherwise re-keyed by hand off an older PI.
let _piConsigneeCache = null; // { at, rows }
const PI_CONSIGNEE_TTL_MS = 10 * 60 * 1000;

// "M/s. Al Jabr. Est." and "AL JABR EST." are one buyer to a human, and to the
// merge below — only letters and digits are compared.
function _piConsigneeKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// The sheet keeps an address on one line; the PI prints it on two (A9 and A10,
// each merged A:G, ~90 characters at 9pt). Only long addresses are split, and
// at the comma nearest the middle so the two lines come out even.
function _piSplitAddress(address) {
  const addr = String(address || '').trim();
  if (addr.length <= 70) return [addr, ''];
  const mid = addr.length / 2;
  let cut = -1;
  for (let i = 0; i < addr.length; i++) {
    if (addr[i] === ',' && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
  }
  if (cut < 0) return [addr, ''];
  return [addr.slice(0, cut).trim(), addr.slice(cut + 1).trim()];
}

async function _loadPiConsigneeMaster() {
  if (_piConsigneeCache && (Date.now() - _piConsigneeCache.at) < PI_CONSIGNEE_TTL_MS) return _piConsigneeCache.rows;
  const auth = getGoogleAuth();
  if (!auth) return [];
  const { google } = require('googleapis');
  const sheets = google.sheets({ version: 'v4', auth });
  const src = PI_FMT.CONSIGNEE_SOURCE;
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: src.spreadsheetId,
    range: `'${src.tab}'!${src.range}`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const values = result.data.values || [];
  const cell = (r, i) => String((r && r[i]) || '').trim();

  // Two blocks, merged by name — see CONSIGNEE_SOURCE. A blank cell never
  // overwrites a filled one, so the older right-hand block keeps supplying
  // contact/email for names whose left-hand row has none.
  const byKey = new Map();
  const upsert = (name, fields) => {
    const key = _piConsigneeKey(name);
    if (!key) return;
    const rec = byKey.get(key) || { name, address: '', contact: '', email: '', placeOfDelivery: '', portOfLoading: '', portOfDischarge: '', paymentTerms: '' };
    rec.name = name; // the left block runs second, so its spelling is the one kept
    for (const f of Object.keys(fields)) if (fields[f]) rec[f] = fields[f];
    byKey.set(key, rec);
  };
  const R = src.right, L = src.left;
  for (const row of values) {
    upsert(cell(row, R.name), {
      address: cell(row, R.address), contact: cell(row, R.contact), email: cell(row, R.email),
      placeOfDelivery: cell(row, R.placeOfDelivery), portOfLoading: cell(row, R.portOfLoading), portOfDischarge: cell(row, R.portOfDischarge),
    });
  }
  for (const row of values) {
    upsert(cell(row, L.name), {
      address: cell(row, L.address), paymentTerms: cell(row, L.paymentTerms),
      placeOfDelivery: cell(row, L.placeOfDelivery), portOfLoading: cell(row, L.portOfLoading), portOfDischarge: cell(row, L.portOfDischarge),
    });
  }

  // Shaped to the create form's fields, so picking a name is a straight
  // field-for-field fill on the client.
  const rows = [...byKey.values()].map(r => {
    const [address1, address2] = _piSplitAddress(r.address);
    return {
      name: r.name,
      address1, address2,
      contact: [r.contact, r.email].filter(Boolean).join(' | '),
      paymentTerms: r.paymentTerms,
      portOfLoading: r.portOfLoading,
      portOfDischarge: r.portOfDischarge,
      placeOfDelivery: r.placeOfDelivery,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  _piConsigneeCache = { at: Date.now(), rows };
  return rows;
}

// The PI's three shipping fields are picked from a list rather than typed.
// The sheet already carries DAMMAN beside DAMMAM, JADDAH beside JEDDAH and
// JABEL ALI beside JEBEL ALI — every hand-typed PI is another chance to add a
// fourth spelling, and the consignee master is keyed on these values.
//
// Options are whatever the master already uses, most-used first (MUNDRA,
// RIYADH and DAMMAM alone cover most PIs) and the long tail alphabetical.
function _piShippingOptions(rows) {
  const pick = (field) => {
    const counts = new Map();
    for (const r of rows) {
      const v = String(r[field] || '').trim();
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([v]) => v);
  };
  return {
    // Not from the master: the company ships out of three ports, and the
    // master's own column spelled two of them four ways (NHAVASHEVA, NSICT,
    // JNPT, GTI). The buyer's list wins here.
    portOfLoading: PI_FMT.DEFAULTS.portOfLoadingOptions.slice(),
    portOfDischarge: pick('portOfDischarge'),
    placeOfDelivery: pick('placeOfDelivery'),
  };
}

// ── Consignee Master (page: consignee-master) ───────────────────────────────
// The same master the PI create form reads, given its own page so a new buyer
// can be entered once instead of being re-typed into every PI.

// GET /api/consignee-master — the whole list, plus whether this user may add
// to it (the page hides the form either way; the POST below is the real gate).
app.get('/api/consignee-master', requireAuth, async (req, res) => {
  try {
    const [rows, canAdd] = await Promise.all([
      _loadPiConsigneeMaster(),
      userCanUseFeature(req.session.user, 'consignee-master', 'add'),
    ]);
    return res.json({ rows, canAdd });
  } catch (e) {
    console.error('[consignee-master] list failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/consignee-master — appends one buyer to the export team's own
// fetch_consignee sheet. Like the product master, this writes into the
// customer's "PI Export (Final)" workbook rather than an app table, so it is
// permission-gated: Admin/HOD always, anyone else only if granted 'add' from
// Users → Access.
//
// Only columns A:F are writable. G:I are the gutter, and J:P are an
// IMPORTRANGE of a different workbook ("Final Consignee") that this app has no
// access to — which is also why the form has no Contact No. / Email ID: those
// two columns live only in that imported master.
app.post('/api/consignee-master', requireAuth, async (req, res) => {
  try {
    const allowed = await userCanUseFeature(req.session.user, 'consignee-master', 'add');
    if (!allowed) return res.status(403).json({ error: 'You do not have permission to add a consignee' });

    const b = req.body || {};
    const val = (k) => String(b[k] || '').trim();
    const name = val('name');
    const placeOfDelivery = val('placeOfDelivery');
    const portOfLoading = val('portOfLoading');
    const portOfDischarge = val('portOfDischarge');
    if (!name) return res.status(400).json({ error: 'Consignee Name is required' });
    // Every buyer already on the sheet carries all three, and a PI cannot be
    // raised without them — a row missing any is not worth adding.
    if (!placeOfDelivery || !portOfLoading || !portOfDischarge) {
      return res.status(400).json({ error: 'Place of Delivery, Port of Loading and Port of Discharge are required' });
    }

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    // The master is keyed by name — a duplicate makes the PI typeahead
    // ambiguous, and the two rows drift apart from there.
    const existing = await _loadPiConsigneeMaster();
    const key = _piConsigneeKey(name);
    const clash = existing.find(c => _piConsigneeKey(c.name) === key);
    if (clash) return res.status(409).json({ error: `"${clash.name}" is already in the consignee master` });

    const address = val('address');
    const src = PI_FMT.CONSIGNEE_SOURCE;
    await sheets.spreadsheets.values.append({
      spreadsheetId: src.spreadsheetId,
      range: `'${src.tab}'!A:F`,
      // RAW, not USER_ENTERED: these are free-text buyer details, and a name or
      // address that happens to start with "=" or "+" must land as text.
      valueInputOption: 'RAW',
      // Deliberately NOT insertDataOption: 'INSERT_ROWS' (which the product
      // master uses) — inserting a sheet row here would shift the IMPORTRANGE
      // block in J:P and break it. Appending over the blank rows below the
      // A:F table leaves everything to the right alone.
      requestBody: {
        values: [[name, val('paymentTerms'), placeOfDelivery, portOfLoading, portOfDischarge, address]],
      },
    });
    _piConsigneeCache = null;   // the next PI typeahead must see it, TTL or not

    const [address1, address2] = _piSplitAddress(address);
    return res.json({
      success: true,
      consignee: { name, address1, address2, contact: '', paymentTerms: val('paymentTerms'), portOfLoading, portOfDischarge, placeOfDelivery },
    });
  } catch (e) {
    console.error('[consignee-master] add failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/proforma-invoice/masters?date=YYYY-MM-DD — next PI number for that
// date's financial year, the boilerplate defaults the create form pre-fills
// (single source: backend/lib/pi-format.js), the consignee master, and a
// lightweight recent-buyers typeahead scraped off the log (which still catches
// one-off buyers that never made it into the consignee sheet).
app.get('/api/proforma-invoice/masters', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const fy = _piFyLabel(req.query.date);
    const [meta, buyerRes, consignees] = await Promise.all([
      _piSheetMeta(fy),
      sheets.spreadsheets.values.get({ spreadsheetId: PI_CREATION_SHEET_ID, range: `'${PI_CREATION_LOG_TAB}'!C2:C`, valueRenderOption: 'FORMATTED_VALUE' }).catch(() => ({ data: {} })),
      // The consignee sheet living outside this app, an unreachable one must
      // not take the whole create form down with it — the field stays free
      // text either way.
      _loadPiConsigneeMaster().catch((e) => { console.error('[proforma-invoice] consignee master load failed:', e.message); return []; }),
    ]);
    const recentBuyers = [...new Set((buyerRes.data.values || []).map(r => (r[0] || '').trim()).filter(Boolean))].slice(-50).reverse();
    return res.json({
      nextPiNumber: _piNoFormat(meta.nextSeq, fy),
      recentBuyers,
      consignees,
      shippingOptions: _piShippingOptions(consignees),
      maxItems: PI_FMT.LAYOUT.itemsLastRow - PI_FMT.LAYOUT.itemsFirstRow + 1,
      defaults: PI_FMT.DEFAULTS,
      // For the Add Price screen's two dropdowns.
      priceTypes: PI_FMT.PRICE_TYPES,
      currencies: Object.keys(PI_FMT.CURRENCIES),
      priceDefault: PI_FMT.PRICE_DEFAULT,
      // For the Order Sheet tab's form, so its standing packing instructions
      // are the same list the server falls back to rather than a second copy
      // typed into the page script.
      orderDefaults: OS_FMT.DEFAULTS,
      orderMaxItems: OS_FMT.LAYOUT.itemsLastRow - OS_FMT.LAYOUT.itemsFirstRow + 1,
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// The finished-goods master, read from the customer's own "PI Export (Final)"
// workbook rather than PO Creation's ITEM_CODES catalog. ITEM_CODES lists
// purchase items (raw material, stores) and carries no packing, CBM, weight or
// photo — everything an export PI line actually needs. fetch_product is
// already keyed exactly to the PI's columns, so picking a Model No. fills the
// whole row and brings its product photo with it.
let _piProductCache = null; // { at, rows }
const PI_PRODUCT_TTL_MS = 10 * 60 * 1000;

async function _loadPiProductCatalog() {
  if (_piProductCache && (Date.now() - _piProductCache.at) < PI_PRODUCT_TTL_MS) return _piProductCache.rows;
  const auth = getGoogleAuth();
  if (!auth) return [];
  const { google } = require('googleapis');
  const sheets = google.sheets({ version: 'v4', auth });
  const src = PI_FMT.PRODUCT_SOURCE;
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: src.spreadsheetId,
    range: `'${src.tab}'!${src.range}`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const c = src.cols;
  const rows = (result.data.values || [])
    .filter(r => String(r[c.modelNo] || '').trim())
    .map(r => ({
      modelNo: String(r[c.modelNo] || '').trim(),
      itemName: String(r[c.itemName] || '').trim(),
      size: String(r[c.size] || '').trim(),
      swg: String(r[c.swg] || '').trim(),
      perBoxPacking: String(r[c.perBoxPacking] || '').trim(),
      perBoxCbm: String(r[c.perBoxCbm] || '').trim(),
      perPcsWeight: String(r[c.perPcsWeight] || '').trim(),
      imageUrl: String(r[c.imageUrl] || '').trim(),
    }));
  _piProductCache = { at: Date.now(), rows };
  return rows;
}

// GET /api/proforma-invoice/items?q=... — Model No. typeahead over that master.
app.get('/api/proforma-invoice/items', requireAuth, async (req, res) => {
  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    const rows = await _loadPiProductCatalog();
    // No cap — see the matching comment on /api/po-creation/items above.
    const matches = query
      ? rows.filter(r => r.modelNo.toLowerCase().includes(query) || r.itemName.toLowerCase().includes(query))
      : rows;
    return res.json(matches);
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// A new product's photo cannot join the folder the existing ones sit in: those
// files are only link-readable to this service account (files.get returns no
// parents), so there is nothing it can add a child to. New photos go in the
// app's own Shared Drive instead, next to User Photos — the URL shape is what
// matters to =IMAGE(), not which folder it came from.
const PI_PRODUCT_PHOTO_FOLDER_NAME = 'Product Photos';
let _piProductPhotoFolderId = null;

async function _ensurePiProductPhotoFolder(drive) {
  if (_piProductPhotoFolderId) return _piProductPhotoFolderId;
  const found = await drive.files.list({
    q: `name = '${PI_PRODUCT_PHOTO_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    corpora: 'drive', driveId: PHOTO_SHARED_DRIVE_ID,
    includeItemsFromAllDrives: true, supportsAllDrives: true,
    fields: 'files(id,name)', pageSize: 1,
  });
  if (found.data.files?.length) { _piProductPhotoFolderId = found.data.files[0].id; return _piProductPhotoFolderId; }
  const created = await drive.files.create({
    requestBody: { name: PI_PRODUCT_PHOTO_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', parents: [PHOTO_SHARED_DRIVE_ID] },
    fields: 'id', supportsAllDrives: true,
  });
  _piProductPhotoFolderId = created.data.id;
  console.log('[pi-product] created Drive folder', PI_PRODUCT_PHOTO_FOLDER_NAME, _piProductPhotoFolderId);
  return _piProductPhotoFolderId;
}

// Returns the thumbnail URL to store in the master — the same shape the
// existing product rows use, and the one =IMAGE() renders reliably.
async function _uploadPiProductPhoto(dataUrl, modelNo) {
  const parsed = _parseImageDataUrl(dataUrl);
  if (!parsed) return '';
  const { google } = require('googleapis');
  const auth = getGoogleAuth();
  if (!auth) return '';
  const drive = google.drive({ version: 'v3', auth });
  const folderId = await _ensurePiProductPhotoFolder(drive);
  const ext = _PHOTO_EXT_BY_MIME[parsed.mimeType] || 'jpg';
  const safeName = String(modelNo || 'product').replace(/[\\/:*?"<>|]/g, '-').trim() || 'product';
  const file = await drive.files.create({
    requestBody: { name: `${safeName}.${ext}`, parents: [folderId] },
    media: { mimeType: parsed.mimeType, body: Readable.from(parsed.buffer) },
    fields: 'id', supportsAllDrives: true,
  });
  // Google's servers fetch this URL on =IMAGE()'s behalf as an anonymous
  // caller, so the file has to be readable by link, not just by the account.
  await drive.permissions.create({
    fileId: file.data.id, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true,
  }).catch(e => console.error('[pi-product] photo share failed:', e.message));
  return `https://drive.google.com/thumbnail?id=${file.data.id}&sz=w400`;
}

// POST /api/proforma-invoice/products — adds a finished good to the shared
// product master so it is immediately pickable on this PI (and every future
// one). This writes into the customer's own "PI Export (Final)" workbook, not
// an app-local table, which is why it is permission-gated the same way pricing
// is: Admin/HOD always, anyone else only if granted 'add_product' from
// Users → Access.
app.post('/api/proforma-invoice/products', requireAuth, async (req, res) => {
  try {
    const allowed = await userCanUseFeature(req.session.user, 'proforma-invoice', 'add_product');
    if (!allowed) return res.status(403).json({ error: 'You do not have permission to add a product' });

    const b = req.body || {};
    const modelNo = String(b.modelNo || '').trim();
    const itemName = String(b.itemName || '').trim();
    if (!modelNo || !itemName) return res.status(400).json({ error: 'Model No. and Item Name are required' });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    // The master is keyed by Model No. — a duplicate would make the typeahead
    // ambiguous and silently price the wrong line later.
    const existing = await _loadPiProductCatalog();
    if (existing.some(p => p.modelNo.toLowerCase() === modelNo.toLowerCase())) {
      return res.status(409).json({ error: `Model No. "${modelNo}" is already in the product master` });
    }

    const product = {
      modelNo, itemName,
      size: String(b.size || '').trim(),
      swg: String(b.swg || '').trim(),
      perBoxPacking: String(b.perBoxPacking || '').trim(),
      perBoxCbm: String(b.perBoxCbm || '').trim(),
      perPcsWeight: String(b.perPcsWeight || '').trim(),
      imageUrl: String(b.imageUrl || '').trim(),
    };
    if (b.photo) {
      try {
        product.imageUrl = (await _uploadPiProductPhoto(b.photo, modelNo)) || product.imageUrl;
      } catch (e) {
        // The product itself is still worth saving — the photo can be added
        // later — but the user must be told the picture didn't make it.
        console.error('[pi-product] photo upload failed:', e.message);
      }
    }

    const src = PI_FMT.PRODUCT_SOURCE;
    await sheets.spreadsheets.values.append({
      spreadsheetId: src.spreadsheetId,
      range: `'${src.tab}'!A:I`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          existing.length + 1, product.modelNo, product.itemName, product.size, product.swg,
          product.perBoxPacking, product.perBoxCbm, product.perPcsWeight, product.imageUrl,
        ]],
      },
    });
    _piProductCache = null;   // the next typeahead must see it, cache TTL or not

    return res.json({ success: true, product, photoSaved: !b.photo || !!product.imageUrl });
  } catch (e) {
    console.error('[pi-product] add failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// Shared by create and revise, so a revision is validated and shaped exactly
// like a first issue rather than by a second, drifting copy of this logic.
//
// A row counts as an item once it names the goods either way round — the model
// number alone is meaningless to the buyer, the item name alone is still a
// valid line.
function _piCleanItems(b) {
  const items = (Array.isArray(b.items) ? b.items : [])
    .filter(it => it && (String(it.modelNo || '').trim() || String(it.itemName || '').trim()))
    .map(it => ({
      modelNo: String(it.modelNo || '').trim(),
      itemName: String(it.itemName || '').trim(),
      size: String(it.size || '').trim(),
      swg: String(it.swg || '').trim(),
      packing: String(it.packing || '').trim(),
      qty: it.qty, boxes: it.boxes, cbm: it.cbm, weight: it.weight,
      remarks: String(it.remarks || '').trim(),
      // Comes from the product master via the form, so the PDF shows the
      // photo without the server having to look the item up again.
      imageUrl: String(it.imageUrl || '').trim(),
    }));
  if (!items.length) return { items, error: 'Add at least one item' };
  const maxItems = PI_FMT.LAYOUT.itemsLastRow - PI_FMT.LAYOUT.itemsFirstRow + 1;
  // The old template silently dropped anything past its last row. Refuse
  // instead — a PI missing lines the user typed is worse than an error.
  if (items.length > maxItems) return { items, error: `The Proforma Invoice template holds ${maxItems} item rows — this PI has ${items.length}` };
  return { items, error: null };
}

// Everything the printed PI needs, kept together so the price step (and any
// later revision) can re-render the exact same document from this one blob.
function _piFormFromBody(b, user, cleanItems) {
  return {
    date: b.date,
    orderNo: String(b.orderNo || '').trim(),
    buyerName: String(b.buyerName).trim(),
    buyerTrn: String(b.buyerTrn || '').trim(),
    buyerAddress1: String(b.buyerAddress1 || '').trim(),
    buyerAddress2: String(b.buyerAddress2 || '').trim(),
    buyerContact: String(b.buyerContact || '').trim(),
    paymentTerms: String(b.paymentTerms || '').trim(),
    portOfLoading: String(b.portOfLoading || PI_FMT.DEFAULTS.portOfLoading).trim(),
    portOfDischarge: String(b.portOfDischarge || '').trim(),
    placeOfDelivery: String(b.placeOfDelivery || '').trim(),
    countryOfOrigin: String(b.countryOfOrigin || PI_FMT.DEFAULTS.countryOfOrigin).trim(),
    shipmentNote: String(b.shipmentNote || PI_FMT.DEFAULTS.shipmentNote).trim(),
    validity: String(b.validity || PI_FMT.DEFAULTS.validity).trim(),
    terms: (Array.isArray(b.terms) ? b.terms : PI_FMT.DEFAULTS.terms).map(t => String(t || '').trim()).filter(Boolean),
    includeDeclaration: b.includeDeclaration !== false,
    piMadeBy: user.name || '',
    // Not printed on the PI — these two exist for the export team's
    // follow-up tracker, which needs an owner and a date per PI.
    // Not asked for on the form any more — every PI's tracker row goes to
    // the same person, and re-assigning is done in the tracker itself.
    assignedTo: PI_FMT.FMS_TRACKER.defaultAssignee,
    targetDate: String(b.targetDate || '').trim(),
    items: cleanItems,
  };
}

// POST /api/proforma-invoice — User stage. No rate/price field is ever read
// from the body here, by design: pricing is a separate, permission-gated
// step (PUT /price below).
app.post('/api/proforma-invoice', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.date || !String(b.buyerName || '').trim()) return res.status(400).json({ error: 'Date and Consignee Name are required' });

    const { items: cleanItems, error: itemsError } = _piCleanItems(b);
    if (itemsError) return res.status(400).json({ error: itemsError });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    const fy = _piFyLabel(b.date);
    const { nextSeq, templateSheetId } = await _piSheetMeta(fy);
    const piNoFormatted = _piNoFormat(nextSeq, fy);

    const form = _piFormFromBody(b, req.session.user, cleanItems);

    await _fillPiTemplate(sheets, { ...form, piNo: piNoFormatted }, templateSheetId);
    const { totalAmount, pdfLink } = await _finishPiSubmission(sheets, piNoFormatted, templateSheetId, PI_FMT.priceLabels(form.priceType, form.currency));

    await ensureLogTab(PI_CREATION_SHEET_ID, PI_CREATION_LOG_TAB, PI_LOG_HEADER);
    await appendLogRow(PI_CREATION_SHEET_ID, PI_CREATION_LOG_TAB, [
      "'" + piNoFormatted, "'" + b.date, form.buyerName, totalAmount ?? '', pdfLink || '', req.session.user.name || '', _timestampForSheet(), '', '',
      JSON.stringify(form),
      'Draft',
    ]);

    // Opens the follow-up row in the export team's tracker. A failure here
    // leaves the PI itself untouched and logged, so it is reported back rather
    // than thrown — the row can be added by hand.
    let fmsTracked = true;
    try {
      const totalQty = cleanItems.reduce((sum, it) => sum + (parseFloat(it.qty) || 0), 0);
      await _appendPiFmsRow(sheets, {
        piNo: piNoFormatted,
        assignedTo: form.assignedTo,
        customerName: form.buyerName,
        quantity: totalQty || '',
        targetDate: form.targetDate,
        // The tracker keeps its own "PI PDF" column, and the export team was
        // pasting this link into it by hand off the PI List.
        pdfLink,
      });
    } catch (e) {
      fmsTracked = false;
      console.error('[proforma-invoice] Export Marketing FMS row failed:', e.message);
    }

    return res.json({ success: true, piNumber: piNoFormatted, pdfLink, fmsTracked });
  } catch (e) { console.error('[proforma-invoice] create failed:', e.message); return res.status(500).json({ error: e.message }); }
});

// DELETE /api/consignee-master?name=... — owner-only, see SUPER_ADMIN_EMAIL.
// Only the writable A:F block can be touched, so this removes the buyer from
// the export team's own list. Anything the imported J:P master still holds for
// that name keeps coming through — that block belongs to another workbook.
app.delete('/api/consignee-master', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const src = PI_FMT.CONSIGNEE_SOURCE;

    const colRes = await sheets.spreadsheets.values.get({
      spreadsheetId: src.spreadsheetId,
      range: `'${src.tab}'!A:A`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const values = colRes.data.values || [];
    const want = _piConsigneeKey(name);
    const rowIndex = values.findIndex((r, i) => i > 0 && _piConsigneeKey(r[0]) === want);
    if (rowIndex === -1) return res.status(404).json({ error: `"${name}" is not in the writable part of the consignee sheet` });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: src.spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
    const tab = meta.data.sheets.find(s => s.properties.title === src.tab);
    if (!tab) return res.status(500).json({ error: 'fetch_consignee tab not found' });

    // Only A:F — deleting the whole sheet row would drag the IMPORTRANGE block
    // in J:P up with it and break the import. Clearing then shifting the cells
    // below up keeps the left block tight without touching anything to the
    // right of it.
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: src.spreadsheetId,
      requestBody: {
        requests: [{
          deleteRange: {
            range: {
              sheetId: tab.properties.sheetId,
              startRowIndex: rowIndex, endRowIndex: rowIndex + 1,
              startColumnIndex: _piColIndex('A'), endColumnIndex: _piColIndex('F') + 1,
            },
            shiftDimension: 'ROWS',
          },
        }],
      },
    });
    _piConsigneeCache = null;

    return res.json({ success: true });
  } catch (e) {
    console.error('[consignee-master] delete failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// POST /api/proforma-invoice/revise?piNo=... — the buyer came back asking for
// changes. Editing the PI in place would leave the copy already sitting in the
// buyer's inbox unaccounted for, and cancelling to start again burns a number
// and loses the thread. So this issues the NEXT REVISION of the same number
// ("VTV/052/25-26" -> "VTV/052/25-26 R1"), marks the parent Superseded, and
// leaves the parent's own PDF in place as the record of what was first offered.
app.post('/api/proforma-invoice/revise', requireAuth, async (req, res) => {
  try {
    const piNo = String(req.query.piNo || '').trim();
    if (!piNo) return res.status(400).json({ error: 'piNo is required' });
    const b = req.body || {};
    if (!b.date || !String(b.buyerName || '').trim()) return res.status(400).json({ error: 'Date and Consignee Name are required' });

    const { items: cleanItems, error: itemsError } = _piCleanItems(b);
    if (itemsError) return res.status(400).json({ error: itemsError });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    const logRes = await sheets.spreadsheets.values.get({ spreadsheetId: PI_CREATION_SHEET_ID, range: `'${PI_CREATION_LOG_TAB}'!A2:K1000`, valueRenderOption: 'FORMATTED_VALUE' });
    const logRows = logRes.data.values || [];
    const parent = logRows.find(r => String(r[0] || '').trim() === piNo);
    if (!parent) return res.status(404).json({ error: `Proforma Invoice ${piNo} was not found` });
    const parentStatus = parent[10] || 'Draft';
    if (parentStatus === 'Cancelled') return res.status(400).json({ error: `${piNo} has been cancelled — a cancelled PI cannot be revised` });
    if (parentStatus === 'Superseded') return res.status(400).json({ error: `${piNo} has already been revised — revise its latest revision instead` });

    let parentForm = {};
    try { parentForm = parent[9] ? JSON.parse(parent[9]) : {}; } catch {}

    // R1 for a first issue, R(n+1) for a PI already revised n times. Counted
    // across the whole family so a gap can never re-issue a number.
    const base = _piBaseNo(piNo);
    const nextRev = logRows.reduce((n, r) => Math.max(n, _piBaseNo(r[0]) === base ? _piRevNo(r[0]) : 0), 0) + 1;
    const newPiNo = `${base} R${nextRev}`;

    // The rate is decided on a permission-gated screen, so a revision must not
    // become a back door for typing one in: rates are read off the PARENT's
    // stored form, never off this request. A line keeps its rate only when its
    // model + size + name matches exactly one line of the parent — anything
    // added, ambiguous or re-specced comes through unpriced and goes back
    // through Add Price.
    const rateKey = (it) => [it.modelNo, it.size, it.itemName].map(v => String(v || '').trim().toLowerCase()).join('|');
    const parentRates = new Map();
    (Array.isArray(parentForm.items) ? parentForm.items : []).forEach(it => {
      const k = rateKey(it);
      parentRates.set(k, parentRates.has(k) ? null : (it.rate ?? ''));
    });
    let allPriced = true;
    cleanItems.forEach(it => {
      const carried = parentRates.get(rateKey(it));
      it.rate = (carried == null ? '' : carried);
      if (!String(it.rate).trim()) allPriced = false;
    });
    const status = (allPriced && parentStatus === 'Priced') ? 'Priced' : 'Draft';

    const form = _piFormFromBody(b, req.session.user, cleanItems);
    form.revisionOf = piNo;
    form.revisionNo = nextRev;
    form.revisionNote = String(b.revisionNote || '').trim();

    const { templateSheetId } = await _piSheetMeta(_piFyLabel(b.date));
    await _fillPiTemplate(sheets, { ...form, piNo: newPiNo }, templateSheetId);
    const { totalAmount, pdfLink } = await _finishPiSubmission(sheets, newPiNo, templateSheetId, PI_FMT.priceLabels(form.priceType, form.currency));

    await ensureLogTab(PI_CREATION_SHEET_ID, PI_CREATION_LOG_TAB, PI_LOG_HEADER);
    await appendLogRow(PI_CREATION_SHEET_ID, PI_CREATION_LOG_TAB, [
      "'" + newPiNo, "'" + b.date, form.buyerName, totalAmount ?? '', pdfLink || '', req.session.user.name || '', _timestampForSheet(),
      // Whoever priced the parent priced these lines too — the revision only
      // carried their figures over.
      status === 'Priced' ? (parent[7] || '') : '', status === 'Priced' ? (parent[8] || '') : '',
      JSON.stringify(form),
      status,
    ]);

    // Only after the revision is safely logged — a failure above must leave
    // the parent live rather than superseded by a PI that does not exist.
    await _setLogRowStatus(PI_CREATION_SHEET_ID, PI_CREATION_LOG_TAB, piNo, 'K', 'Superseded');

    // No new Export Marketing FMS row: the parent PI already opened one and
    // the export team follows the deal, not each revision of the paperwork.
    return res.json({ success: true, piNumber: newPiNo, pdfLink, status, revisedFrom: piNo, ratesCarried: status === 'Priced' });
  } catch (e) {
    console.error('[proforma-invoice] revise failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/proforma-invoice/list — recent PIs, newest first, capped at 200 —
// same shape as PO/PR/GRN's own /list routes. `canSetPrice` is computed
// server-side (per current user + Draft-only) so the frontend never has to
// re-derive the permission logic itself.
app.get('/api/proforma-invoice/list', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({ spreadsheetId: PI_CREATION_SHEET_ID, range: `'${PI_CREATION_LOG_TAB}'!A2:K1000`, valueRenderOption: 'FORMATTED_VALUE' });
    const canSetPrice = await userCanUseFeature(req.session.user, 'proforma-invoice', 'set_price');
    const rows = (result.data.values || []).map(r => {
      let form = null;
      try { form = r[9] ? JSON.parse(r[9]) : null; } catch {}
      const status = r[10] || 'Draft';
      return {
        piNo: r[0] || '', date: _sheetDateToIso(r[1]), buyer: r[2] || '', total: r[3] || '', pdfLink: r[4] || '',
        createdBy: r[5] || '', createdAt: r[6] || '', pricedBy: r[7] || '', pricedAt: r[8] || '',
        form, status, canSetPrice: canSetPrice && status === 'Draft',
        // Only the live copy of a PI can be revised — not a cancelled one, and
        // not one that has already been superseded by its own revision.
        canRevise: status === 'Draft' || status === 'Priced',
      };
    }).reverse().slice(0, 200);
    return res.json(rows);
  } catch (e) {
    if (/unable to parse range/i.test(e.message || '')) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// Marks the Export Marketing FMS tracker's "Add Pricing" step done for one PI,
// with the same next-step email the manual Mark-as-Done path sends. Returns
// true only when this call is what actually closed the step.
async function _closePiPricingStep(piNo, userName) {
  if (!FMS_ENABLED) return false;
  try {
    const done = await fmsSheet.completePiPricingStep({ piNo, userName });
    if (!done || done.alreadyDone) return false;
    sendFmsNextStepEmail({ sheet: done.sheet, step: done.step, rowNumber: done.rowNumber, doneByName: userName })
      .catch(e => console.error('[fms-mail] next-step notification failed:', e.message));
    return true;
  } catch (e) {
    console.error('[proforma-invoice] could not close the FMS pricing step for', piNo + ':', e.message);
    return false;
  }
}

// PUT /api/proforma-invoice/price?piNo=... — Admin (or a User explicitly
// granted the 'set_price' feature via Users → Access tab) stage. Loads the
// PI's own stored Form JSON for buyer/item/qty details (the template tab may
// belong to a different, newer PI by now), merges in rate/GST/freight, does
// a full re-fill + re-export, then updates the SAME log row in place.
app.put('/api/proforma-invoice/price', requireAuth, async (req, res) => {
  try {
    const piNo = req.query.piNo;
    if (!piNo) return res.status(400).json({ error: 'piNo is required' });
    const allowed = await userCanUseFeature(req.session.user, 'proforma-invoice', 'set_price');
    if (!allowed) return res.status(403).json({ error: 'You do not have permission to add price to a Proforma Invoice' });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    const rowIndex = await _findRowIndexByKey(PI_CREATION_SHEET_ID, PI_CREATION_LOG_TAB, piNo);
    const rowRes = await sheets.spreadsheets.values.get({ spreadsheetId: PI_CREATION_SHEET_ID, range: `'${PI_CREATION_LOG_TAB}'!A${rowIndex + 1}:K${rowIndex + 1}`, valueRenderOption: 'FORMATTED_VALUE' });
    const rowVals = rowRes.data.values?.[0] || [];
    if ((rowVals[10] || 'Draft') === 'Cancelled') return res.status(400).json({ error: 'This Proforma Invoice has been cancelled' });
    let existingForm = {};
    try { existingForm = rowVals[9] ? JSON.parse(rowVals[9]) : {}; } catch {}

    // Rates arrive keyed by row index, not by model number — an export PI can
    // legitimately list the same model twice at different sizes, and keying by
    // code would price both rows off whichever one was sent last.
    const rateByIndex = {};
    (Array.isArray(req.body?.items) ? req.body.items : []).forEach(it => {
      if (it && it.index != null && !isNaN(parseInt(it.index, 10))) rateByIndex[parseInt(it.index, 10)] = it.rate;
    });
    // Drafts raised before the export format existed carry itemCode/description
    // instead of modelNo/itemName. Map them across rather than printing a PI
    // with two blank columns.
    const mergedItems = (existingForm.items || []).map((it, i) => ({
      ...it,
      modelNo: it.modelNo || it.itemCode || '',
      itemName: it.itemName || it.description || '',
      rate: rateByIndex[i] ?? it.rate,
    }));

    // Price basis and currency are chosen here, alongside the rates — the two
    // labels the whole printed document is built from. Only values off the
    // known lists are accepted: a typo would otherwise print on the PI as the
    // buyer's price basis. Re-pricing without sending them keeps what the PI
    // already had.
    const wantType = String(req.body?.priceType || '').trim();
    const wantCurrency = String(req.body?.currency || '').trim().toUpperCase();
    if (wantType && !PI_FMT.PRICE_TYPES.includes(wantType)) {
      return res.status(400).json({ error: `Price type must be one of ${PI_FMT.PRICE_TYPES.join(', ')}` });
    }
    if (wantCurrency && !PI_FMT.CURRENCIES[wantCurrency]) {
      return res.status(400).json({ error: `Currency must be one of ${Object.keys(PI_FMT.CURRENCIES).join(', ')}` });
    }
    const pricedForm = {
      ...existingForm,
      items: mergedItems,
      priceType: wantType || existingForm.priceType || PI_FMT.PRICE_DEFAULT.priceType,
      currency: wantCurrency || existingForm.currency || PI_FMT.PRICE_DEFAULT.currency,
    };

    const { templateSheetId } = await _piSheetMeta(_piFyLabel(existingForm.date));
    await _fillPiTemplate(sheets, { ...pricedForm, piNo }, templateSheetId);
    const { totalAmount, pdfLink } = await _finishPiSubmission(sheets, piNo, templateSheetId, PI_FMT.priceLabels(pricedForm.priceType, pricedForm.currency));

    await _updateLogRowCells(PI_CREATION_SHEET_ID, PI_CREATION_LOG_TAB, piNo, {
      D: totalAmount ?? '', E: pdfLink || rowVals[4] || '', H: req.session.user.name || '', I: _timestampForSheet(),
      J: JSON.stringify(pricedForm), K: 'Priced',
    });

    // Pricing the PI IS the export tracker's "Add Pricing" step, so close it
    // here rather than making the same person go back and tick it off. Never
    // fatal: the price is already saved by this point, and a tracker that is
    // unreachable (or simply not configured) must not turn a successful
    // pricing into an error.
    const fmsStepDone = await _closePiPricingStep(piNo, req.session.user.name || '');

    return res.json({ success: true, piNo, totalAmount, pdfLink, fmsStepDone });
  } catch (e) {
    console.error('[proforma-invoice] price update failed:', e.message);
    return res.status(e.notFound ? 404 : 500).json({ error: e.message });
  }
});

// PUT /api/proforma-invoice/cancel?piNo=... — same Cancel-in-place pattern
// as PO/PR/GRN: flips Status only, never deletes the row or touches the
// archived PDF. Available at any status (Draft or Priced), same precedent.
app.put('/api/proforma-invoice/cancel', requireAuth, async (req, res) => {
  try {
    const piNo = req.query.piNo;
    if (!piNo) return res.status(400).json({ error: 'piNo is required' });
    await _setLogRowStatus(PI_CREATION_SHEET_ID, PI_CREATION_LOG_TAB, piNo, 'K', 'Cancelled');
    return res.json({ success: true });
  } catch (e) { return res.status(e.notFound ? 404 : 500).json({ error: e.message }); }
});

// Owner-only — see SUPER_ADMIN_EMAIL. Worth knowing before using it on a PI:
// the next PI number is the highest one on this log plus one, so deleting the
// most recent PI hands its number to the next one raised — while the PDF of
// the deleted one may already be with the buyer. Cancel (which keeps the row
// and burns the number) is the safer move in almost every case.
app.delete('/api/proforma-invoice', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const piNo = req.query.piNo;
    if (!piNo) return res.status(400).json({ error: 'piNo is required' });
    await _deleteLogRowByKey(PI_CREATION_SHEET_ID, PI_CREATION_LOG_TAB, piNo);
    return res.json({ success: true });
  } catch (e) { return res.status(e.notFound ? 404 : 500).json({ error: e.message }); }
});

// ── Order Sheet ───────────────────────────────────────────────────────────
// Raised once a PI is final and the advance has landed. Same buyer and the
// same lines as the PI, with NO money anywhere on the page — see
// backend/lib/order-sheet-format.js for why it is not simply a second PI.
//
// It lives in the PI's own workbook, on the "Order sheet" tab painted by
// scripts/build-order-sheet.js, and is logged to "ERP Order sheet Log" the
// same way every PI is logged to "ERP PI Log".
const OS_FMT = require('./backend/lib/order-sheet-format.js');
const ORDER_SHEET_TAB = 'Order sheet';
const ORDER_LOG_TAB = 'ERP Order sheet Log';
const ORDER_NO_PREFIX = 'VTV/ORD';   // "VTV/ORD/001/26-27" — the PI series with ORD in it

function _orderNoFormat(seq, fy) {
  return `${ORDER_NO_PREFIX}/${String(seq).padStart(3, '0')}/${fy}`;
}

// Mirrors _piSeqOf: only THIS financial year's numbers count towards the next
// one, so the series restarts at 001 each April.
function _orderSeqOf(raw, fy) {
  const m = /^[A-Za-z]+\/[A-Za-z]+\/(\d+)\/(\d{2}-\d{2})$/i.exec(String(raw ?? '').trim());
  return m && m[2] === fy ? parseInt(m[1], 10) : 0;
}

async function _orderSheetMeta(fy) {
  const auth = getGoogleAuth();
  const { google } = require('googleapis');
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: PI_CREATION_SHEET_ID });
  const tpl = meta.data.sheets.find(s => s.properties.title === ORDER_SHEET_TAB);
  if (!tpl) throw new Error(`The "${ORDER_SHEET_TAB}" tab is missing from the PI workbook`);
  let maxSeq = 0;
  try {
    const logRes = await sheets.spreadsheets.values.get({ spreadsheetId: PI_CREATION_SHEET_ID, range: `'${ORDER_LOG_TAB}'!A2:A`, valueRenderOption: 'FORMATTED_VALUE' });
    for (const row of (logRes.data.values || [])) maxSeq = Math.max(maxSeq, _orderSeqOf(row[0], fy));
  } catch (e) {
    if (!/unable to parse range/i.test(e.message || '')) console.error('[order-sheet] log read for numbering failed:', e.message);
  }
  return { nextSeq: maxSeq + 1, templateSheetId: tpl.properties.sheetId };
}

// Same shape as _piCleanItems, minus the rate. Dropping it HERE rather than
// at the sheet is what guarantees a price can never reach an order sheet:
// there is no rate on the stored form, so there is nothing to print even if
// the request carried one.
function _orderCleanItems(b) {
  const items = (Array.isArray(b.items) ? b.items : [])
    .filter(it => it && (String(it.modelNo || '').trim() || String(it.itemName || '').trim()))
    .map(it => ({
      modelNo: String(it.modelNo || '').trim(),
      itemName: String(it.itemName || '').trim(),
      size: String(it.size || '').trim(),
      swg: String(it.swg || '').trim(),
      packing: String(it.packing || '').trim(),
      qty: it.qty, boxes: it.boxes, cbm: it.cbm, weight: it.weight,
      remarks: String(it.remarks || '').trim(),
      imageUrl: String(it.imageUrl || '').trim(),
    }));
  if (!items.length) return { items, error: 'Add at least one item' };
  const maxItems = OS_FMT.LAYOUT.itemsLastRow - OS_FMT.LAYOUT.itemsFirstRow + 1;
  if (items.length > maxItems) return { items, error: `The Order Sheet template holds ${maxItems} item rows — this order has ${items.length}` };
  return { items, error: null };
}

// Everything the printed Order Sheet needs, kept together so it can be
// re-rendered later from this one blob — same discipline as _piFormFromBody.
//
// The customer and the shipping terms come from the PI's OWN stored form and
// never from the request: the order confirms that PI, so it has to say what
// the PI said. Only the four order-side dates and the notes are the user's to
// give here.
function _orderFormFromBody(b, pi, user, cleanItems) {
  const p = pi || {};
  return {
    orderDate: String(b.orderDate || '').trim(),
    piNo: String(b.piNo || '').trim(),
    piDate: String(p.date || '').trim(),
    advanceReceivedOn: String(b.advanceReceivedOn || '').trim(),
    deliveryDate: String(b.deliveryDate || '').trim(),
    buyerName: String(p.buyerName || '').trim(),
    buyerTrn: String(p.buyerTrn || '').trim(),
    buyerAddress1: String(p.buyerAddress1 || '').trim(),
    buyerAddress2: String(p.buyerAddress2 || '').trim(),
    buyerContact: String(p.buyerContact || '').trim(),
    buyerEmail: String(b.buyerEmail || '').trim(),
    paymentTerms: String(p.paymentTerms || '').trim(),
    portOfLoading: String(p.portOfLoading || '').trim(),
    portOfDischarge: String(p.portOfDischarge || '').trim(),
    placeOfDelivery: String(p.placeOfDelivery || '').trim(),
    shipmentNote: String(b.shipmentNote || p.shipmentNote || OS_FMT.DEFAULTS.shipmentNote).trim(),
    notes: (Array.isArray(b.notes) && b.notes.length ? b.notes : OS_FMT.DEFAULTS.notes)
      .map(t => String(t || '').trim()).filter(Boolean),
    madeBy: user.name || '',
    items: cleanItems,
  };
}

// Fills the "Order sheet" tab as a FULL rewrite of the current order — same
// rule as _fillPiTemplate: every mapped cell is written even when blank, or a
// leftover value from the previous order prints on this one.
async function _fillOrderTemplate(sheets, form, templateSheetId) {
  const tab = ORDER_SHEET_TAB;
  const { LAYOUT: L, CELLS: C, ITEMS: IT } = OS_FMT;
  const items = form.items || [];

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: PI_CREATION_SHEET_ID,
    requestBody: { ranges: IT.clearRanges.map(([a, b]) => `'${tab}'!${a}${L.itemsFirstRow}:${b}${L.itemsLastRow}`) },
  });

  // Photo merges left by the PREVIOUS order have to go before anything is
  // written: a value aimed at a cell swallowed by a merge never lands.
  const canGroupPhotos = templateSheetId != null;
  const photoColIdx = _piColIndex(IT.photoCol);
  if (canGroupPhotos) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: PI_CREATION_SHEET_ID,
      requestBody: {
        requests: [{
          unmergeCells: {
            range: {
              sheetId: templateSheetId,
              startRowIndex: L.itemsFirstRow - 1, endRowIndex: L.itemsLastRow,
              startColumnIndex: photoColIdx, endColumnIndex: photoColIdx + 1,
            },
          },
        }],
      },
    });
  }

  const capacity = L.itemsLastRow - L.itemsFirstRow + 1;
  const photoGroups = _piPhotoGroups(items.slice(0, capacity));
  const photoRows = new Set(canGroupPhotos ? photoGroups.map(g => g.start) : items.map((_, i) => i));

  const data = [];
  const putRaw = (a1, value) => data.push({ range: `'${tab}'!${a1}`, values: [[value ?? '']] });
  const put = (a1, value) => putRaw(a1, _sheetText(value));
  const putText = (a1, value) => putRaw(a1, value ? "'" + value : '');   // force text, never a parsed date/number

  putText(C.orderNo, form.orderNo);
  putText(C.orderDate, _piDisplayDate(form.orderDate));
  putText(C.piNo, form.piNo);
  putText(C.piDate, _piDisplayDate(form.piDate));
  putText(C.advanceReceivedOn, _piDisplayDate(form.advanceReceivedOn));
  putText(C.deliveryDate, _piDisplayDate(form.deliveryDate));
  put(C.paymentTerms, form.paymentTerms);
  put(C.portOfLoading, form.portOfLoading);
  put(C.portOfDischarge, form.portOfDischarge);
  put(C.placeOfDelivery, form.placeOfDelivery);
  put(C.buyerName, form.buyerName);
  put(C.buyerTrn, form.buyerTrn);
  put(C.buyerAddress1, form.buyerAddress1);
  put(C.buyerAddress2, form.buyerAddress2);
  put(C.buyerContact, form.buyerContact);
  put(C.buyerEmail, form.buyerEmail);
  put(C.shipmentNote, form.shipmentNote);

  // Whatever the stored form says, verbatim — _orderFormFromBody has already
  // settled what an order with no notes of its own falls back to.
  const notes = form.notes || [];
  for (let r = L.notesFirstRow; r <= L.notesLastRow; r++) put(`A${r}`, notes[r - L.notesFirstRow] || '');

  items.forEach((it, i) => {
    const row = L.itemsFirstRow + i;
    if (row > L.itemsLastRow) return;   // beyond capacity — see the cap enforced in POST
    put(`${IT.srNoCol}${row}`, i + 1);
    Object.entries(IT.fields).forEach(([field, col]) => put(`${col}${row}`, it[field]));
    put(`${IT.remarksCol}${row}`, it.remarks);
    putRaw(`${IT.photoCol}${row}`, photoRows.has(i) ? _piPhotoFormula(it.imageUrl) : '');
  });

  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: PI_CREATION_SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data } });

  // Collapse the unused tail of the 30-row table — hidden rows are left out of
  // the PDF export — and re-show whatever the previous order had hidden.
  if (templateSheetId != null) {
    const firstIdx = L.itemsFirstRow - 1;
    const endIdx = L.itemsLastRow;
    const usedEnd = Math.min(firstIdx + Math.max(items.length, 1), endIdx);
    const rowRange = (startIndex, endIndex, hidden) => ({
      updateDimensionProperties: {
        range: { sheetId: templateSheetId, dimension: 'ROWS', startIndex, endIndex },
        properties: { hiddenByUser: hidden }, fields: 'hiddenByUser',
      },
    });
    const requests = [rowRange(firstIdx, usedEnd, false)];
    if (usedEnd < endIdx) requests.push(rowRange(usedEnd, endIdx, true));

    // Every used line gets the same height, so the table reads as one block —
    // the reasoning is spelled out on _fillPiTemplate.
    const rowPx = photoGroups.some(g => g.photo) ? L.itemRowHeightWithPhoto : L.itemRowHeight;
    items.slice(0, endIdx - firstIdx).forEach((_, i) => {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: templateSheetId, dimension: 'ROWS', startIndex: firstIdx + i, endIndex: firstIdx + i + 1 },
          properties: { pixelSize: rowPx }, fields: 'pixelSize',
        },
      });
    });

    // Nothing is hidden on this document — Total Weight in particular is the
    // whole point of it — but the loop is kept so the format file stays the
    // one place that decides.
    (IT.printHiddenCols || []).forEach(col => {
      const idx = _piColIndex(col);
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: templateSheetId, dimension: 'COLUMNS', startIndex: idx, endIndex: idx + 1 },
          properties: { hiddenByUser: true }, fields: 'hiddenByUser',
        },
      });
    });

    // One Photo cell per product, spanning that product's size lines.
    photoGroups.forEach(g => {
      if (g.count < 2) return;
      requests.push({
        mergeCells: {
          range: {
            sheetId: templateSheetId,
            startRowIndex: firstIdx + g.start, endRowIndex: firstIdx + g.start + g.count,
            startColumnIndex: photoColIdx, endColumnIndex: photoColIdx + 1,
          },
          mergeType: 'MERGE_ALL',
        },
      });
    });
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: PI_CREATION_SHEET_ID, requestBody: { requests } });
  }
}

// Exports the filled tab and files the PDF next to the PIs. Shorter than the
// PI's equivalent because there is no total to read back and no amount in
// words to stamp — the pause is only to let the =IMAGE() photos render before
// the page is captured. Never lets a Drive/export hiccup block the data write.
async function _finishOrderSubmission(orderNo, templateSheetId) {
  await _sleep(2000);
  try {
    const pdfBuffer = await _exportSheetTabPdf(PI_CREATION_SHEET_ID, templateSheetId, {
      c1: 0, c2: OS_FMT.LAYOUT.colCount, r1: 0, r2: OS_FMT.LAYOUT.lastRow, portrait: true, scale: 4,
    });
    // "VTV/ORD/001/26-27" has slashes in it — a Drive filename must not.
    return await safeUploadPdfToDrive(pdfBuffer, `${orderNo.replace(/\//g, '-')} - Order Sheet.pdf`, PI_PDF_DRIVE_FOLDER_ID);
  } catch (e) {
    console.error('[order-sheet] PDF export failed:', e.message);
    return null;
  }
}

// Reads one PI's stored form out of the PI log. The order sheet is built from
// it rather than from the request, so a user cannot quietly re-address the
// order to a different buyer than the PI they picked.
async function _piFormByNo(sheets, piNo) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: PI_CREATION_SHEET_ID,
    range: `'${PI_CREATION_LOG_TAB}'!A2:K1000`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const row = (res.data.values || []).find(r => String(r[0] || '').trim() === String(piNo).trim());
  if (!row) return { form: null, status: null, pdfLink: '', notFound: true };
  let form = null;
  try { form = row[9] ? JSON.parse(row[9]) : null; } catch {}
  // The PI's own PDF travels with the order onto the dispatch tracker, which
  // lists both documents side by side.
  return { form, status: row[10] || 'Draft', pdfLink: row[4] || '', notFound: false };
}

// POST /api/order-sheet — raises the Order Sheet for one PI: fills the tab,
// exports the PDF and logs the order. Body carries only the order-side fields;
// everything about the customer and the goods comes from the PI.
app.post('/api/order-sheet', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const piNo = String(b.piNo || '').trim();
    if (!piNo) return res.status(400).json({ error: 'Pick the Proforma Invoice this order is against' });
    if (!b.orderDate) return res.status(400).json({ error: 'Order Date is required' });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    const { form: piForm, status: piStatus, pdfLink: piPdfLink, notFound } = await _piFormByNo(sheets, piNo);
    if (notFound) return res.status(404).json({ error: 'PI ' + piNo + ' is not on the PI log' });
    if (!piForm) return res.status(400).json({ error: 'PI ' + piNo + ' has no saved detail to build an order from' });
    // An order sheet says the goods are going into production. A cancelled PI
    // is dead and a superseded one has been replaced by its own revision —
    // neither is the paperwork the buyer is holding.
    if (piStatus === 'Cancelled' || piStatus === 'Superseded') {
      return res.status(400).json({ error: 'PI ' + piNo + ' is ' + piStatus + ' — raise the order against the PI in force' });
    }

    // Items default to the PI's own lines; the form may send them back edited
    // (a part shipment, a corrected box count) but never with a rate attached.
    const { items: cleanItems, error: itemsError } = _orderCleanItems(
      Array.isArray(b.items) && b.items.length ? b : { items: piForm.items || [] }
    );
    if (itemsError) return res.status(400).json({ error: itemsError });

    const fy = _piFyLabel(b.orderDate);
    const { nextSeq, templateSheetId } = await _orderSheetMeta(fy);
    const orderNo = _orderNoFormat(nextSeq, fy);

    const form = _orderFormFromBody(b, piForm, req.session.user, cleanItems);

    await _fillOrderTemplate(sheets, { ...form, orderNo }, templateSheetId);
    const pdfLink = await _finishOrderSubmission(orderNo, templateSheetId);

    const totalQty = cleanItems.reduce((sum, it) => sum + (parseFloat(it.qty) || 0), 0);
    await ensureLogTab(PI_CREATION_SHEET_ID, ORDER_LOG_TAB, OS_FMT.ORDER_LOG_HEADER);
    await appendLogRow(PI_CREATION_SHEET_ID, ORDER_LOG_TAB, [
      "'" + orderNo, "'" + b.orderDate, "'" + piNo, form.buyerName, totalQty || '', pdfLink || '',
      req.session.user.name || '', _timestampForSheet(),
      JSON.stringify(form),
      'Open',
    ]);

    // Opens the order's row in the "Order to dispatch" flow. Reported back
    // rather than thrown — the order itself is already filled, exported and
    // logged by this point, and the row can be added by hand.
    let fmsTracked = true;
    try {
      await _appendOrderFmsRow(sheets, {
        orderNo,
        customerName: form.buyerName,
        // "Location" on that tracker is where the goods are going.
        location: form.placeOfDelivery || form.portOfDischarge || '',
        advanceDate: form.advanceReceivedOn,
        dueDate: form.deliveryDate,
        orderPdfLink: pdfLink || '',
        piPdfLink: piPdfLink || '',
      });
    } catch (e) {
      fmsTracked = false;
      console.error('[order-sheet] Order to dispatch FMS row failed:', e.message);
    }

    return res.json({ success: true, orderNo, pdfLink, piNo, fmsTracked });
  } catch (e) {
    console.error('[order-sheet] create failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// GET /api/order-sheet/list — recent order sheets, newest first, capped at 200.
app.get('/api/order-sheet/list', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const result = await sheets.spreadsheets.values.get({ spreadsheetId: PI_CREATION_SHEET_ID, range: `'${ORDER_LOG_TAB}'!A2:J1000`, valueRenderOption: 'FORMATTED_VALUE' });
    const rows = (result.data.values || []).map(r => {
      let form = null;
      try { form = r[8] ? JSON.parse(r[8]) : null; } catch {}
      return {
        orderNo: r[0] || '', orderDate: _sheetDateToIso(r[1]), piNo: r[2] || '', buyer: r[3] || '',
        totalQty: r[4] || '', pdfLink: r[5] || '', createdBy: r[6] || '', createdAt: r[7] || '',
        form, status: r[9] || 'Open',
      };
    }).reverse().slice(0, 200);
    return res.json(rows);
  } catch (e) {
    if (/unable to parse range/i.test(e.message || '')) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// PUT /api/order-sheet/cancel?orderNo=... — flips Status only, same
// Cancel-in-place pattern as the PI: the row stays and the archived PDF is
// never touched.
app.put('/api/order-sheet/cancel', requireAuth, async (req, res) => {
  try {
    const orderNo = req.query.orderNo;
    if (!orderNo) return res.status(400).json({ error: 'orderNo is required' });
    await _setLogRowStatus(PI_CREATION_SHEET_ID, ORDER_LOG_TAB, orderNo, 'J', 'Cancelled');
    return res.json({ success: true });
  } catch (e) { return res.status(e.notFound ? 404 : 500).json({ error: e.message }); }
});

// Owner-only, and worth the same warning the PI's delete carries: the next
// order number is the highest on this log plus one, so deleting the most
// recent order hands its number to the next one raised.
app.delete('/api/order-sheet', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const orderNo = req.query.orderNo;
    if (!orderNo) return res.status(400).json({ error: 'orderNo is required' });
    await _deleteLogRowByKey(PI_CREATION_SHEET_ID, ORDER_LOG_TAB, orderNo);
    return res.json({ success: true });
  } catch (e) { return res.status(e.notFound ? 404 : 500).json({ error: e.message }); }
});

// ── Payment Entries ───────────────────────────────────────────────────────────

// Next 'PE######' id, keyed off the highest numeric suffix ever issued — not
// COUNT(*). Both POST and PATCH below used to seed their id counter from
// COUNT(*), but every Save Draft click deletes-then-reinserts drafts, so ids
// get burned without the row count ever dropping to match. COUNT(*) then
// drifts below the highest id actually in the table and collides with an
// existing row ("Duplicate entry 'PE000092' for key 'PRIMARY'"). Same fix as
// nextDelId() above for delegations.
async function nextPaymentEntryId() {
  const rows = await q("SELECT MAX(CAST(SUBSTRING(id,3) AS UNSIGNED)) AS maxnum FROM payment_entries WHERE id REGEXP '^PE[0-9]+'");
  return (rows.length && rows[0].maxnum) ? parseInt(rows[0].maxnum) || 0 : 0;
}

// GET /api/payment-entries — return all draft entries
app.get('/api/payment-entries', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const rows = await q(`SELECT id, vendor_id, amount, txn_type, narration, status, created_by, created_at FROM payment_entries WHERE status='draft' ORDER BY created_at ASC`);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// POST /api/payment-entries — replace all drafts with submitted array
app.post('/api/payment-entries', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const entries = req.body?.entries;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries array required' });
    const user = req.session?.user?.name || req.session?.user?.email || '';
    // Delete all current drafts then re-insert
    await pool.query(`DELETE FROM payment_entries WHERE status='draft'`);
    let counter = 0;
    let base = await nextPaymentEntryId();
    for (const e of entries) {
      if (!e.vendorId || !e.amount) continue;
      counter++;
      const eid = 'PE' + String(base + counter).padStart(6, '0');
      await pool.query(
        `INSERT INTO payment_entries (id, vendor_id, amount, txn_type, narration, status, created_by) VALUES ($1,$2,$3,$4,$5,'draft',$6)`,
        [eid, String(e.vendorId), parseFloat(e.amount) || 0, e.txnType || 'N', e.narration || '', user]
      );
    }
    return res.json({ success: true, saved: counter });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// PATCH /api/payment-entries — mark exported entries as such, recording history
//
// Entries exported straight from freshly-typed rows (never saved as a draft first)
// have no id yet — inserting them here rather than silently dropping them is what
// keeps Payment History from losing those exports.
app.patch('/api/payment-entries', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { entries, batchLabel } = req.body || {};
    if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: 'entries required' });
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const label = batchLabel || ('Export ' + new Date().toLocaleDateString('en-IN'));
    const user = req.session?.user?.name || req.session?.user?.email || '';
    let base = await nextPaymentEntryId();
    const ids = [];
    for (const e of entries) {
      if (e.id) {
        await pool.query(
          `UPDATE payment_entries SET status='exported', exported_at=$1, batch_label=$2 WHERE id=$3`,
          [now, label, e.id]
        );
        ids.push(e.id);
      } else if (e.vendorId && e.amount) {
        base++;
        const eid = 'PE' + String(base).padStart(6, '0');
        await pool.query(
          `INSERT INTO payment_entries (id, vendor_id, amount, txn_type, narration, status, created_by, exported_at, batch_label)
           VALUES ($1,$2,$3,$4,$5,'exported',$6,$7,$8)`,
          [eid, String(e.vendorId), parseFloat(e.amount) || 0, e.txnType || 'N', e.narration || '', user, now, label]
        );
        ids.push(eid);
      }
    }
    return res.json({ success: true, ids });
  } catch (err) { console.error('[payment-entries] PATCH failed:', err.message); return res.status(500).json({ error: err.message }); }
});

// GET /api/payment-history — exported entries with vendor info
app.get('/api/payment-history', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const rows = await q(`
      SELECT pe.id, pe.vendor_id, pe.amount, pe.txn_type, pe.narration,
             pe.batch_label, pe.exported_at, pe.created_by,
             c.name AS vendor_name, c.account_no, c.ifsc_code, c.bank_name, c.account_holder
      FROM payment_entries pe
      LEFT JOIN clients c ON c.id = pe.vendor_id
      WHERE pe.status = 'exported'
      ORDER BY pe.exported_at DESC
    `);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ── Inventory Management (IMS): item master + Inward/Outward stock ledger ─────
// MySQL/Postgres-backed (see ims_items/ims_transactions in SCHEMA) — unlike
// PR/PO/GRN this has nothing to do with Google Sheets. current_stock on
// ims_items is a maintained running total, only ever moved by the Inward/
// Outward create/cancel routes below — PATCH /api/ims/items never touches it.

// GET /api/ims/masters — dropdown data shared by the Inward/Outward forms.
// categoryTabs drives the IMS page's top-level book tabs (see
// IMS_CATEGORY_TABS); categories stays the full set of valid values so an
// item already filed under a non-tabbed book (Trading) still validates.
app.get('/api/ims/masters', requireAuth, async (req, res) => {
  return res.json({ departments: await listDepartments(), categories: IMS_CATEGORIES, categoryTabs: IMS_CATEGORY_TABS, sources: IMS_SOURCES });
});

// GET /api/ims/items?q=&lowStock=1&category=Stores — item master search; backs
// both the IMS dashboard table and the Inward/Outward item-code typeahead.
// category is omitted/'' for "All".
app.get('/api/ims/items', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const search = String(req.query.q || '').trim();
    const lowStock = req.query.lowStock === '1';
    const negativeStock = req.query.negativeStock === '1';
    const category = String(req.query.category || '').trim();
    // itemCode/itemName are separate, AND-combined filters used by the IMS
    // Report tab's advanced filter bar -- distinct from `q` above, which
    // OR-matches both and is what the Inward/Outward item-code typeahead uses.
    const itemCode = String(req.query.itemCode || '').trim();
    const itemName = String(req.query.itemName || '').trim();
    const minStock = req.query.minStock !== undefined && req.query.minStock !== '' ? parseFloat(req.query.minStock) : null;
    const maxStock = req.query.maxStock !== undefined && req.query.maxStock !== '' ? parseFloat(req.query.maxStock) : null;
    const clauses = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      clauses.push(`(item_code LIKE $${params.length - 1} OR description LIKE $${params.length})`);
    }
    if (itemCode) { params.push(`%${itemCode}%`); clauses.push(`item_code LIKE $${params.length}`); }
    if (itemName) { params.push(`%${itemName}%`); clauses.push(`description LIKE $${params.length}`); }
    if (lowStock) clauses.push('current_stock <= moq');
    if (negativeStock) clauses.push('current_stock < 0');
    if (Number.isFinite(minStock)) { params.push(minStock); clauses.push(`current_stock >= $${params.length}`); }
    if (Number.isFinite(maxStock)) { params.push(maxStock); clauses.push(`current_stock <= $${params.length}`); }
    if (category) { params.push(category); clauses.push(`category = $${params.length}`); }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    // No LIMIT — the ALU catalog alone now runs to ~1257 rows, well past the
    // old 500 cap that used to silently drop the tail end of the Report tab's
    // item list and the Inward/Outward item-code typeahead's search results.
    const rows = await q(
      `SELECT item_code AS itemCode, description, size, uom, moq, max_level AS maxLevel, on_order_qty AS onOrderQty,
              vendor_name AS vendorName, current_stock AS currentStock, category
       FROM ims_items ${where} ORDER BY item_code ASC`, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// Day-wise range presets the front end offers — capped at 92 so the query
// below (and the resulting table) never has to render more than ~3 months.
const IMS_STOCK_HISTORY_DAY_OPTIONS = [7, 14, 21, 30, 92];

// "Today" in India time regardless of which timezone the server itself runs
// in (same reasoning as _timestampForSheet above) — the day-wise columns must
// line up with the business's calendar day, not Hostinger's container clock.
function _todayIsoIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
// Pure calendar-date subtraction via Date.UTC (no local-timezone conversion
// involved at any point), so this is safe independent of server timezone.
function _isoDateMinusDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}
// mysql2 returns DATE columns as a Date object built from the stored
// calendar fields in the connection's local timezone — reading it back with
// getFullYear/getMonth/getDate (not toISOString, which round-trips through
// UTC) is what keeps the day from shifting depending on server timezone.
function _isoDateOnly(v) {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  if (typeof v === 'string') return v.slice(0, 10);
  return null;
}

// GET /api/ims/stock-history?days=7&q=&category= — closing stock per item for
// each of the last N days (default 7; see IMS_STOCK_HISTORY_DAY_OPTIONS for the
// front-end's 7/14/21/30/"3 months" toggle), matching the day-by-day matrix on
// the reference Google Sheet. There's no daily-snapshot table — current_stock
// is the only stored balance — so each day is reconstructed by walking
// backward from today's current_stock and undoing one day of net movement at
// a time. Only status='Active' transactions count: a Cancelled entry's delta
// was already reversed out of current_stock when it was cancelled, so
// re-subtracting it here would double-count it.
app.get('/api/ims/stock-history', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    let days = parseInt(req.query.days, 10);
    if (!Number.isFinite(days) || days <= 0) days = 7;
    days = Math.min(days, 92);
    const search = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();

    const clauses = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      clauses.push(`(item_code LIKE $${params.length - 1} OR description LIKE $${params.length})`);
    }
    if (category) { params.push(category); clauses.push(`category = $${params.length}`); }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    // No LIMIT — see the matching comment on /api/ims/items above.
    const items = await q(
      `SELECT item_code AS itemCode, description, size, uom, category, current_stock AS currentStock, max_level AS maxLevel
       FROM ims_items ${where} ORDER BY item_code ASC`, params);
    if (!items.length) return res.json({ dates: [], items: [] });

    // Oldest → newest, ending today (matches the sheet's left-to-right date order).
    const todayIso = _todayIsoIST();
    const dates = [];
    for (let i = days - 1; i >= 0; i--) dates.push(_isoDateMinusDays(todayIso, i));

    // Self-contained placeholder numbering starting at $1 -- this query doesn't
    // reference the outer `params` (search/category, already applied to the
    // ims_items query above) at all, so continuing to number from params.length
    // left $1..$params.length unused in the text. pgToMysql's $N->? replace only
    // sees the placeholders that actually appear, so the resulting param COUNT
    // (params.length + 1 + codes.length passed in) didn't match the ? COUNT in
    // the text (1 + codes.length) whenever a search/category filter was active
    // -- MySQL then rejected the mismatched bind count with "Incorrect arguments
    // to mysqld_stmt_execute".
    const codes = items.map(it => it.itemCode);
    const codePlaceholders = codes.map((_, i) => `$${i + 2}`).join(',');
    const txnRows = await q(
      `SELECT item_code AS itemCode, txn_date AS txnDate, direction, SUM(quantity) AS qty
       FROM ims_transactions
       WHERE status='Active' AND txn_date >= $1 AND item_code IN (${codePlaceholders})
       GROUP BY item_code, txn_date, direction`,
      [dates[0], ...codes]
    );

    // net.get(itemCode).get(isoDate) = that item's (IN total - OUT total) for that day.
    const net = new Map();
    for (const r of txnRows) {
      if (!net.has(r.itemCode)) net.set(r.itemCode, new Map());
      const dayMap = net.get(r.itemCode);
      const dateKey = _isoDateOnly(r.txnDate);
      // IN/OUT quantities are always stored positive (direction carries the
      // sign); ADJ (physical-stock adjustment, see _imsPhysicalStockUpdate)
      // stores the signed variance directly in quantity, so it's added as-is.
      const signed = r.direction === 'OUT' ? -Number(r.qty || 0) : Number(r.qty || 0);
      dayMap.set(dateKey, (dayMap.get(dateKey) || 0) + signed);
    }

    const result = items.map(it => {
      const dayMap = net.get(it.itemCode) || new Map();
      const daily = new Array(dates.length);
      let running = Number(it.currentStock) || 0;
      daily[dates.length - 1] = running; // today = current_stock, exactly
      for (let i = dates.length - 1; i >= 1; i--) {
        running -= (dayMap.get(dates[i]) || 0);
        daily[i - 1] = running;
      }
      return { itemCode: it.itemCode, description: it.description, size: it.size, uom: it.uom, category: it.category, currentStock: it.currentStock, maxLevel: it.maxLevel, daily };
    });

    return res.json({ dates, dayOptions: IMS_STOCK_HISTORY_DAY_OPTIONS, items: result });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ── Alloy series (Trading book) ──────────────────────────────────────────────
// Trading stock is Hindalco aluminium bar/rod, and its alloy grade lives inside
// the description rather than in a column of its own:
//   'Alum. Bar 10336 x 6082T6 x 2500'  ->  6082
// These four grades cover all but a handful of the Trading catalog, so they are
// the fixed buckets of the Series tab's chart (see ims.js); anything that
// matches none of them lands in 'Other' rather than inventing a bucket per
// stray number.
const IMS_ALLOY_SERIES = ['6061', '6082', '7075', '2014'];
// The grade digits must not be flanked by other digits, so neither a bar length
// nor a die number ('12014', '60612', '20140') can be misread as a grade — a
// trailing temper ('6082T6', '6082-T6') still matches.
const IMS_ALLOY_SERIES_RE = new RegExp('(?:^|[^0-9])(' + IMS_ALLOY_SERIES.join('|') + ')(?![0-9])');
function _imsAlloySeries(text) {
  const m = IMS_ALLOY_SERIES_RE.exec(String(text || ''));
  return m ? m[1] : 'Other';
}

// GET /api/ims/series-summary?category=Trading&from=&to= — per-alloy-series
// rollup behind the Trading page's Series tab: how many catalog items carry
// each grade, their combined current stock, and how much moved in/out over the
// (optional) date window. Rolled up here rather than in the browser because
// /api/ims/inward|outward/list are capped at their 1000 most recent rows, which
// the Trading ledger is well past — charting those would silently plot a slice.
// Physical-stock adjustments (direction 'ADJ') are left out of the in/out
// figures: they're corrections to a count, not stock movement. They do still
// show up in current stock, which is the stored balance they were applied to.
app.get('/api/ims/series-summary', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const category = String(req.query.category || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    const itemParams = [];
    let itemWhere = '';
    if (category) { itemParams.push(category); itemWhere = 'WHERE category = $1'; }
    const items = await q(
      `SELECT item_code AS itemCode, description, size, current_stock AS currentStock
       FROM ims_items ${itemWhere}`, itemParams);

    const buckets = new Map();
    function bucket(name) {
      if (!buckets.has(name)) buckets.set(name, { series: name, items: 0, stock: 0, inward: 0, outward: 0 });
      return buckets.get(name);
    }
    IMS_ALLOY_SERIES.forEach(name => bucket(name)); // every known grade charts, even at zero

    // item_code -> series, so the transaction rollup below buckets by lookup
    // instead of re-parsing a description per transaction row.
    const seriesOf = new Map();
    for (const it of items) {
      const name = _imsAlloySeries(`${it.description || ''} ${it.size || ''}`);
      seriesOf.set(it.itemCode, name);
      const b = bucket(name);
      b.items += 1;
      b.stock += Number(it.currentStock) || 0;
    }

    const txnParams = [];
    const txnClauses = ["t.status = 'Active'", "t.direction IN ('IN','OUT')"];
    let join = '';
    if (category) {
      txnParams.push(category);
      join = 'JOIN ims_items i ON i.item_code = t.item_code';
      txnClauses.push(`i.category = $${txnParams.length}`);
    }
    if (from) { txnParams.push(from); txnClauses.push(`t.txn_date >= $${txnParams.length}`); }
    if (to)   { txnParams.push(to);   txnClauses.push(`t.txn_date <= $${txnParams.length}`); }
    // Grouped by day as well as item+direction so the same read serves both the
    // period totals and the month-by-month breakdown. Bucketing the months in
    // JS rather than SQL keeps this portable — DATE_FORMAT/TO_CHAR would pin
    // the query to one of MySQL/Postgres, and this app runs on either.
    const txns = await q(
      `SELECT t.item_code AS itemCode, t.direction, t.txn_date AS txnDate, SUM(t.quantity) AS qty
       FROM ims_transactions t ${join}
       WHERE ${txnClauses.join(' AND ')}
       GROUP BY t.item_code, t.direction, t.txn_date`, txnParams);

    // months.get('2026-08').get('6061') = {inward, outward} for that month.
    const months = new Map();
    for (const r of txns) {
      const name = seriesOf.get(r.itemCode) || 'Other';
      const b = bucket(name);
      const qty = Number(r.qty) || 0;
      const out = r.direction === 'OUT';
      if (out) b.outward += qty; else b.inward += qty;

      const month = (_isoDateOnly(r.txnDate) || '').slice(0, 7);
      if (!month) continue;
      if (!months.has(month)) months.set(month, new Map());
      const bySeries = months.get(month);
      if (!bySeries.has(name)) bySeries.set(name, { inward: 0, outward: 0 });
      const cell = bySeries.get(name);
      if (out) cell.outward += qty; else cell.inward += qty;
    }

    // Fixed grade order, 'Other' last — never sorted by value, so a bar keeps
    // its place (and its colour) as the date filter moves.
    const round2 = (n) => Math.round(n * 100) / 100;
    const order = [...IMS_ALLOY_SERIES, 'Other'].filter(name => buckets.has(name));
    const series = order.map(name => {
      const b = buckets.get(name);
      return { series: b.series, items: b.items, stock: round2(b.stock), inward: round2(b.inward), outward: round2(b.outward) };
    });

    // Oldest → newest, one entry per month that actually saw movement. Every
    // series carries a number in every month (zero where nothing moved) so the
    // client can plot straight off it without filling gaps itself.
    const monthly = [...months.keys()].sort().map(month => {
      const bySeries = months.get(month);
      const row = { month, series: {} };
      order.forEach(name => {
        const cell = bySeries.get(name) || { inward: 0, outward: 0 };
        row.series[name] = { inward: round2(cell.inward), outward: round2(cell.outward) };
      });
      return row;
    });

    return res.json({ series, monthly, from, to, knownSeries: IMS_ALLOY_SERIES });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// POST /api/ims/items — add a new catalog item.
app.post('/api/ims/items', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body || {};
    const itemCode = String(b.itemCode || '').trim();
    if (!itemCode) return res.status(400).json({ error: 'itemCode is required' });
    const existing = await q('SELECT item_code FROM ims_items WHERE item_code=$1', [itemCode]);
    if (existing.length) return res.status(409).json({ error: 'Item code already exists' });
    const category = IMS_CATEGORIES.includes(b.category) ? b.category : 'Stores';
    await pool.query(
      `INSERT INTO ims_items (item_code, description, size, uom, moq, max_level, on_order_qty, vendor_name, current_stock, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [itemCode, b.description || '', b.size || '', b.uom || '', parseFloat(b.moq) || 0, parseFloat(b.maxLevel) || 0,
       parseFloat(b.onOrderQty) || 0, b.vendorName || '', parseFloat(b.openingStock) || 0, category]
    );
    return res.status(201).json({ success: true, itemCode });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// PATCH /api/ims/items/:code — edit catalog fields. current_stock is
// deliberately not settable here — see comment above.
app.patch('/api/ims/items/:code', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const code = req.params.code;
    const b = req.body || {};
    const category = b.category === undefined ? null : (IMS_CATEGORIES.includes(b.category) ? b.category : null);
    await pool.query(
      `UPDATE ims_items SET description=COALESCE($1,description), size=COALESCE($2,size), uom=COALESCE($3,uom),
       moq=COALESCE($4,moq), max_level=COALESCE($5,max_level), on_order_qty=COALESCE($6,on_order_qty),
       vendor_name=COALESCE($7,vendor_name), category=COALESCE($8,category), updated_at=NOW() WHERE item_code=$9`,
      [b.description ?? null, b.size ?? null, b.uom ?? null,
       b.moq === undefined ? null : (parseFloat(b.moq) || 0), b.maxLevel === undefined ? null : (parseFloat(b.maxLevel) || 0),
       b.onOrderQty === undefined ? null : (parseFloat(b.onOrderQty) || 0), b.vendorName ?? null, category, code]
    );
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// Shared create/cancel logic for Inward and Outward — identical apart from
// `direction`, so both route pairs below just call these.
async function _imsCreateTxn(direction, body, user) {
  const itemCode = String(body.itemCode || '').trim();
  const quantity = parseFloat(body.quantity);
  if (!itemCode) throw Object.assign(new Error('itemCode is required'), { status: 400 });
  if (!quantity || quantity <= 0) throw Object.assign(new Error('quantity must be greater than 0'), { status: 400 });
  const txnDate = body.date || new Date().toISOString().slice(0, 10);
  // Only the Trading form sends this (see inward.js/outward.js); every other
  // book posts nothing and stores '', exactly as before the column existed.
  const size = String(body.size || '').trim().slice(0, 64);

  const existing = await q('SELECT item_code FROM ims_items WHERE item_code=$1', [itemCode]);
  if (!existing.length) {
    // Unknown item code — auto-create a minimal catalog stub rather than
    // blocking the entry; store staff can fill in MOQ/Max Level/Vendor later
    // from the IMS page. Matches the "never block a real transaction" call.
    // category comes from whichever catalog (Stores/ALU) was selected on the
    // Inward/Outward form -- without this every auto-created stub silently
    // fell back to the schema default ('Stores'), even when logged as ALU.
    const category = IMS_CATEGORIES.includes(body.category) ? body.category : 'Stores';
    await pool.query(
      `INSERT INTO ims_items (item_code, description, size, uom, current_stock, category) VALUES ($1,$2,$3,$4,0,$5)`,
      [itemCode, body.description || '', size, body.uom || '', category]
    );
  }

  const cnt = await q('SELECT COUNT(*) AS c FROM ims_transactions WHERE direction=$1', [direction]);
  const id = direction + String(Number(cnt[0]?.c || 0) + 1).padStart(6, '0');
  // source is only meaningful for the Trading category (see IMS_SOURCES) —
  // Stores/ALU entries just get '', same as before this column existed.
  const source = IMS_SOURCES.includes(body.source) ? body.source : '';
  // The Inward/Outward forms can post a department typed straight into the
  // "+ Add new department" box, so it is canonicalised here rather than trusted.
  const department = await canonicalDept(body.department);
  await pool.query(
    `INSERT INTO ims_transactions (id, txn_date, direction, item_code, item_name, size, quantity, uom, department, remarks, status, created_by, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Active',$11,$12)`,
    [id, txnDate, direction, itemCode, body.description || '', size, quantity, body.uom || '', department, body.remarks || '', user, source]
  );
  const delta = direction === 'IN' ? quantity : -quantity;
  await pool.query('UPDATE ims_items SET current_stock = current_stock + $1 WHERE item_code=$2', [delta, itemCode]);
  return id;
}

async function _imsCancelTxn(id, direction) {
  const rows = await q('SELECT * FROM ims_transactions WHERE id=$1 AND direction=$2', [id, direction]);
  if (!rows.length) throw Object.assign(new Error('Not found'), { status: 404 });
  const row = rows[0];
  if (row.status === 'Cancelled') return; // already cancelled — no-op, not an error
  await pool.query(`UPDATE ims_transactions SET status='Cancelled' WHERE id=$1`, [id]);
  // Reverse the stock impact: an IN added +quantity, so cancelling it removes
  // that quantity again; an OUT subtracted quantity, so cancelling it gives it
  // back. ADJ (physical-stock adjustment) stores its already-signed variance
  // in quantity and was added exactly like IN, so it reverses the same way.
  // Skipping this would let current_stock silently drift from reality.
  const delta = direction === 'OUT' ? Number(row.quantity) : -Number(row.quantity);
  await pool.query('UPDATE ims_items SET current_stock = current_stock + $1 WHERE item_code=$2', [delta, row.item_code]);
}

// Owner-only delete of one ledger entry — see SUPER_ADMIN_EMAIL.
//
// current_stock is a stored running balance, not something recomputed from the
// ledger, so a live row's effect has to be backed out before the row goes —
// exactly as Cancel does. A row that is ALREADY Cancelled was reversed at
// cancel time and must not be reversed a second time, or the stock swings the
// wrong way by that quantity.
async function _imsDeleteTxn(id) {
  const rows = await q('SELECT * FROM ims_transactions WHERE id=$1', [id]);
  if (!rows.length) throw Object.assign(new Error('Not found'), { status: 404 });
  const row = rows[0];
  if (row.status !== 'Cancelled') {
    const delta = row.direction === 'OUT' ? Number(row.quantity) : -Number(row.quantity);
    await pool.query('UPDATE ims_items SET current_stock = current_stock + $1 WHERE item_code=$2', [delta, row.item_code]);
  }
  await pool.query('DELETE FROM ims_transactions WHERE id=$1', [id]);
}

// Physical Stock update — reconciles current_stock against what store staff
// physically counted. Unlike Inward/Outward this doesn't add a fixed unsigned
// quantity in a known direction: it computes the signed variance itself
// (physicalStock - system stock) and logs that variance as an 'ADJ' entry in
// the same ims_transactions ledger (direction fits VARCHAR(3) same as IN/OUT),
// so Day-wise Stock (see the ADJ handling above) and Cancel both stay correct
// without a separate table. Always logs, even when variance is 0, so a
// physical count that confirmed the system was right is still on record.
async function _imsPhysicalStockUpdate(body, user) {
  const itemCode = String(body.itemCode || '').trim();
  const physicalStock = parseFloat(body.physicalStock);
  if (!itemCode) throw Object.assign(new Error('itemCode is required'), { status: 400 });
  if (!Number.isFinite(physicalStock) || physicalStock < 0) throw Object.assign(new Error('physicalStock must be a number 0 or greater'), { status: 400 });
  const txnDate = body.date || new Date().toISOString().slice(0, 10);

  const existing = await q('SELECT * FROM ims_items WHERE item_code=$1', [itemCode]);
  if (!existing.length) throw Object.assign(new Error('Unknown item code — add it on the IMS page first'), { status: 404 });
  const item = existing[0];
  const systemStock = Number(item.current_stock) || 0;
  const variance = Math.round((physicalStock - systemStock) * 100) / 100;

  const cnt = await q(`SELECT COUNT(*) AS c FROM ims_transactions WHERE direction='ADJ'`);
  const id = 'ADJ' + String(Number(cnt[0]?.c || 0) + 1).padStart(6, '0');
  const remarksNote = `Physical count: ${physicalStock} (system was ${systemStock}, variance ${variance > 0 ? '+' : ''}${variance}).`
    + (body.remarks ? ` ${body.remarks}` : '');
  await pool.query(
    `INSERT INTO ims_transactions (id, txn_date, direction, item_code, item_name, size, quantity, uom, department, remarks, status, created_by, source)
     VALUES ($1,$2,'ADJ',$3,$4,$5,$6,$7,'',$8,'Active',$9,'')`,
    [id, txnDate, itemCode, item.description || '', item.size || '', variance, item.uom || '', remarksNote, user]
  );
  if (variance !== 0) {
    await pool.query('UPDATE ims_items SET current_stock = current_stock + $1 WHERE item_code=$2', [variance, itemCode]);
  }
  return { id, systemStock, physicalStock, variance };
}

// Ledger lists are scoped to one book via ?category= (the IMS page's Inward/
// Outward/Physical tabs each belong to exactly one book — see
// IMS_CATEGORY_TABS). ims_transactions itself carries no category: an entry
// belongs to whichever book its item is filed under, so the filter joins
// through ims_items on item_code. Omitting the param keeps the old
// every-book behaviour. The LIMIT is applied after filtering, so a book's
// tab shows its own 1000 most recent entries rather than whatever survives a
// global cut-off.
function _imsTxnListQuery(direction, category, columns) {
  const params = [direction];
  let sql = `SELECT ${columns} FROM ims_transactions t`;
  if (category) sql += ' JOIN ims_items i ON i.item_code = t.item_code';
  sql += ' WHERE t.direction = $1';
  if (category) { params.push(category); sql += ` AND i.category = $${params.length}`; }
  sql += ' ORDER BY t.created_at DESC LIMIT 1000';
  return { sql, params };
}
const IMS_TXN_LIST_COLUMNS = `t.id, t.txn_date AS date, t.item_code AS itemCode, t.item_name AS itemName,
  t.size, t.quantity, t.uom, t.department, t.remarks, t.status, t.created_by AS createdBy, t.created_at AS createdAt, t.source`;

app.get('/api/ims/inward/list', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { sql, params } = _imsTxnListQuery('IN', String(req.query.category || '').trim(), IMS_TXN_LIST_COLUMNS);
    const rows = await q(sql, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post('/api/ims/inward', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const user = req.session?.user?.name || req.session?.user?.email || '';
    const id = await _imsCreateTxn('IN', req.body || {}, user);
    return res.status(201).json({ success: true, id });
  } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
});

app.put('/api/ims/inward/cancel', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    await _imsCancelTxn(id, 'IN');
    return res.json({ success: true });
  } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
});

// Owner-only — see SUPER_ADMIN_EMAIL. Cancel keeps the entry in the ledger;
// this removes it, reversing its stock effect first if it is still live.
app.delete('/api/ims/inward', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    await _imsDeleteTxn(id);
    return res.json({ success: true });
  } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
});

app.get('/api/ims/outward/list', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { sql, params } = _imsTxnListQuery('OUT', String(req.query.category || '').trim(), IMS_TXN_LIST_COLUMNS);
    const rows = await q(sql, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post('/api/ims/outward', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const user = req.session?.user?.name || req.session?.user?.email || '';
    const id = await _imsCreateTxn('OUT', req.body || {}, user);
    return res.status(201).json({ success: true, id });
  } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
});

app.put('/api/ims/outward/cancel', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    await _imsCancelTxn(id, 'OUT');
    return res.json({ success: true });
  } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
});

// Owner-only — see SUPER_ADMIN_EMAIL. Cancel keeps the entry in the ledger;
// this removes it, reversing its stock effect first if it is still live.
app.delete('/api/ims/outward', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    await _imsDeleteTxn(id);
    return res.json({ success: true });
  } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
});

// GET /api/ims/physical-stock/list — audit log of every physical-stock count
// logged from the IMS Report tab (see _imsPhysicalStockUpdate above).
app.get('/api/ims/physical-stock/list', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { sql, params } = _imsTxnListQuery('ADJ', String(req.query.category || '').trim(),
      `t.id, t.txn_date AS date, t.item_code AS itemCode, t.item_name AS itemName,
       t.quantity AS variance, t.remarks, t.status, t.created_by AS createdBy, t.created_at AS createdAt`);
    const rows = await q(sql, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post('/api/ims/physical-stock', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const user = req.session?.user?.name || req.session?.user?.email || '';
    const result = await _imsPhysicalStockUpdate(req.body || {}, user);
    return res.status(201).json({ success: true, ...result });
  } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
});

app.put('/api/ims/physical-stock/cancel', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id is required' });
    await _imsCancelTxn(id, 'ADJ');
    return res.json({ success: true });
  } catch (err) { return res.status(err.status || 500).json({ error: err.message }); }
});

// ── MIS ───────────────────────────────────────────────────────────────────────
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
// A masters row is one dated occurrence of a recurring checklist, never a template
// (see the comment above addChecklistInterval) — so a checklist MIS has to scope to
// the occurrences that actually land in the report window. Counting the series
// instead made a one-week report list the whole year: 365 rows behind a daily task,
// none of them completable inside the window, so every score read -100%. Undated
// legacy rows fall back to created_at, the way the delegation branches already do.
const inChecklistWindow = (m, from, to) => {
  const on = m.startDate ?? m.start_date ?? null;
  if (on) { const d = new Date(on); return d >= from && d <= to; }
  const made = m.createdAt ?? m.created_at ?? null;
  return made ? (new Date(made) >= from && new Date(made) <= to) : false;
};

app.get('/api/mis', requireAuth, async (req, res) => {
  const { start, end, employee } = req.query;
  const type = req.query.type || 'Delegation MIS';
  if (!start||!end) return res.status(400).json({ error:'start and end required' });

  const from = new Date(start); const to = new Date(end); to.setHours(23,59,59);
  const now = new Date();
  const fromISO = from.toISOString(); const toISO = to.toISOString();
  const fromDT = start+' 00:00:00'; const toDT = end+' 23:59:59';

  try {
    // FMS data is Google-Sheets-backed, not store/DB rows — handled the same way
    // regardless of USE_DB, ahead of the store-vs-DB split below.
    if (type === 'FMS MIS' && FMS_ENABLED) {
      if (employee) {
        const detailRows = await fmsSheet.getFmsMisDetailRows(employee, start, end);
        const rows = detailRows.map((r, i) => ({
          '#': i + 1,
          'Description': `${r.fmsName} · ${r.stepName}`,
          'Assigned By': '—',
          'Due Date': r.planValue || '',
          'Status': r.status === 'completed' ? 'done' : 'pending',
        }));
        return res.json({ rows, summary: {} });
      }
      const misRows = await fmsSheet.getFmsMisRows(start, end);
      const rows = misRows.map(e => ({
        ...e, revised: 0,
        score: e.total > 0 ? Math.round(((e.completed / e.total) - 1) * 100 - (e.delayed / e.total) * 50) : 0,
      }));
      const summary = {
        'Total Steps': misRows.reduce((s, e) => s + e.total, 0),
        'Employees': rows.length,
        'Completed': misRows.reduce((s, e) => s + e.completed, 0),
        'Pending': misRows.reduce((s, e) => s + e.pending, 0),
        'Delayed': misRows.reduce((s, e) => s + e.delayed, 0),
        'Period': `${fmtDate(fromISO)} – ${fmtDate(toISO)}`,
      };
      return res.json({ rows, summary, view: 'employee' });
    }

    if (!USE_DB) {
      const store = await readStore();
      if (employee&&(type==='Delegation MIS'||type==='All MIS')) {
        const data = (store.delegations||[]).filter(d => {
          if (d.doer!==employee) return false;
          const due = d.dueDate ? new Date(d.dueDate) : null;
          if (due) return due>=from&&due<=to;
          return new Date(d.createdAt)>=from&&new Date(d.createdAt)<=to;
        });
        const users = store.users||[];
        const rows = data.map((d,i) => { const assignedBy=users.find(u=>u.id===d.delegatedBy)?.name||d.delegatedBy||'—'; return {'#':i+1,'Description':(d.description||'').substring(0,100),'Assigned By':assignedBy,'Client':d.client||'—','Due Date':fmtDate(d.dueDate),'Priority':d.priority||'Low','Status':d.status||'—'}; });
        return res.json({ rows, summary:{} });
      }
      if (type==='Delegation MIS'||type==='All MIS') {
        const data = (store.delegations||[]).filter(d => { const due=d.dueDate?new Date(d.dueDate):null; if(due) return due>=from&&due<=to; return new Date(d.createdAt)>=from&&new Date(d.createdAt)<=to; });
        const empMap={};
        for (const t of data) {
          const name=t.doer||'Unknown';
          if (!empMap[name]) empMap[name]={name,total:0,completed:0,pending:0,revised:0,delayed:0};
          const e=empMap[name]; e.total++;
          if (t.status==='done') { e.completed++; }
          else if (t.status==='revise'||t.status==='revise_requested') { e.revised++; e.pending++; if(t.dueDate&&new Date(t.dueDate)<now) e.delayed++; }
          else { e.pending++; if(t.dueDate&&new Date(t.dueDate)<now) e.delayed++; }
        }
        const rows = Object.values(empMap).map(e=>({...e,score:e.total>0?Math.round(((e.completed/e.total)-1)*100-(e.delayed/e.total)*50):0}));
        const summary = {'Total Tasks':data.length,'Employees':rows.length,'Completed':data.filter(d=>d.status==='done').length,'Pending':data.filter(d=>d.status!=='done').length,'Delayed':data.filter(d=>d.status!=='done'&&d.dueDate&&new Date(d.dueDate)<now).length,'Period':`${fmtDate(fromISO)} – ${fmtDate(toISO)}`};
        return res.json({ rows, summary, view:'employee' });
      }
      if (employee&&type==='Checklist MIS') {
        const mine=(store.masters||[]).filter(m=>(m.assignedTo||'').trim().toLowerCase()===String(employee).trim().toLowerCase()&&inChecklistWindow(m,from,to));
        const rows=mine.map((m,i)=>({'#':i+1,'Description':(m.task||'').substring(0,100),'Assigned By':'—','Due Date':m.startDate?fmtDate(m.startDate):(m.frequency||'—'),'Status':'pending'}));
        return res.json({ rows, summary:{} });
      }
      if (type==='Checklist MIS') {
        const masters=(store.masters||[]).filter(m=>inChecklistWindow(m,from,to)); const empMap={};
        for (const m of masters) { const name=m.assignedTo||'Unknown'; if(!empMap[name]) empMap[name]={name,total:0,completed:0,pending:0,revised:0,delayed:0}; empMap[name].total++; empMap[name].pending++; }
        const rows=Object.values(empMap).map(e=>({...e,score:e.total>0?Math.round(((e.completed/e.total)-1)*100):0}));
        const summary={'Total Checklists':masters.length,'Employees':rows.length,'Completions':0,'Period':`${fmtDate(fromISO)} – ${fmtDate(toISO)}`};
        return res.json({ rows, summary, view:'employee' });
      }
      return res.json({ rows:[], summary:{} });
    }

    await ensureSchema();
    if (employee&&(type==='Delegation MIS'||type==='All MIS')) {
      const data = await q(`SELECT d.id, d.description, d.client, d.due_date, d.priority, d.status, u.name AS delegated_by_name FROM delegations d LEFT JOIN users u ON u.id=d.delegated_by WHERE d.doer=$1 AND ((d.due_date IS NOT NULL AND d.due_date BETWEEN $2 AND $3) OR (d.due_date IS NULL AND d.created_at BETWEEN $4 AND $5)) ORDER BY d.due_date ASC`, [employee,fromDT,toDT,fromDT,toDT]);
      const rows = data.map((d,i) => ({'#':i+1,'Description':(d.description||'').substring(0,100),'Assigned By':d.delegated_by_name||d.delegated_by||'—','Client':d.client||'—','Due Date':fmtDate(d.due_date),'Priority':d.priority||'Low','Status':d.status||'—'}));
      return res.json({ rows, summary:{} });
    }
    if (type==='Delegation MIS'||type==='All MIS') {
      const data = await q(`SELECT doer, status, due_date FROM delegations WHERE (due_date IS NOT NULL AND due_date BETWEEN $1 AND $2) OR (due_date IS NULL AND created_at BETWEEN $3 AND $4) ORDER BY doer ASC`, [fromDT,toDT,fromDT,toDT]);
      const empMap={};
      for (const t of data) {
        const name=t.doer||'Unknown';
        if (!empMap[name]) empMap[name]={name,total:0,completed:0,pending:0,revised:0,delayed:0};
        const e=empMap[name]; e.total++;
        if (t.status==='done') { e.completed++; }
        else if (t.status==='revise'||t.status==='revise_requested') { e.revised++; e.pending++; if(t.due_date&&new Date(t.due_date)<now) e.delayed++; }
        else { e.pending++; if(t.due_date&&new Date(t.due_date)<now) e.delayed++; }
      }
      const rows=Object.values(empMap).map(e=>({...e,score:e.total>0?Math.round(((e.completed/e.total)-1)*100-(e.delayed/e.total)*50):0}));
      const summary={'Total Tasks':data.length,'Employees':rows.length,'Completed':data.filter(d=>d.status==='done').length,'Pending':data.filter(d=>d.status!=='done').length,'Delayed':data.filter(d=>d.status!=='done'&&d.due_date&&new Date(d.due_date)<now).length,'Period':`${fmtDate(fromDT)} – ${fmtDate(toDT)}`};
      return res.json({ rows, summary, view:'employee' });
    }
    // Row-level drill-down for a single employee. Without this, clicking a name
    // on the Checklist tab fell through to the aggregate branch below and the
    // modal rendered one blank row per employee. The date window matters as much
    // as the branch does — see inChecklistWindow.
    if (employee&&type==='Checklist MIS') {
      const [masters, completions] = await Promise.all([
        q('SELECT id, task, frequency, start_date FROM masters WHERE LOWER(TRIM(assigned_to))=LOWER(TRIM($1)) AND ((start_date IS NOT NULL AND start_date BETWEEN $2 AND $3) OR (start_date IS NULL AND created_at BETWEEN $4 AND $5)) ORDER BY start_date, id', [employee,start,end,fromDT,toDT]),
        q('SELECT master_id FROM checklist_completions WHERE date BETWEEN $1 AND $2', [start,end]).catch(()=>[]),
      ]);
      const doneSet = new Set(completions.map(c=>c.master_id));
      const rows = masters.map((m,i) => ({'#':i+1,'Description':(m.task||'').substring(0,100),'Assigned By':'—','Due Date':m.start_date?fmtDate(m.start_date):(m.frequency||'—'),'Status':doneSet.has(m.id)?'done':'pending'}));
      return res.json({ rows, summary:{} });
    }
    if (type==='Checklist MIS') {
      const [masters, completions] = await Promise.all([
        q('SELECT id, task, assigned_to, frequency FROM masters WHERE (start_date IS NOT NULL AND start_date BETWEEN $1 AND $2) OR (start_date IS NULL AND created_at BETWEEN $3 AND $4) ORDER BY assigned_to, start_date, id', [start,end,fromDT,toDT]),
        q('SELECT master_id FROM checklist_completions WHERE date BETWEEN $1 AND $2', [start,end]).catch(()=>[]),
      ]);
      const doneSet={};
      for (const c of completions) doneSet[c.master_id]=(doneSet[c.master_id]||0)+1;
      const empMap={};
      for (const m of masters) { const name=m.assigned_to||'Unknown'; if(!empMap[name]) empMap[name]={name,total:0,completed:0,pending:0,revised:0,delayed:0}; empMap[name].total++; if(doneSet[m.id]>0) empMap[name].completed++; else empMap[name].pending++; }
      const rows=Object.values(empMap).map(e=>({...e,score:e.total>0?Math.round(((e.completed/e.total)-1)*100):0}));
      const summary={'Total Checklists':masters.length,'Employees':rows.length,'Completions':completions.length,'Period':`${fmtDate(fromDT)} – ${fmtDate(toDT)}`};
      return res.json({ rows, summary, view:'employee' });
    }
  } catch (err) { console.error('[MIS API]',err.message); return res.status(500).json({ error:err.message }); }
  return res.json({ rows:[], summary:{} });
});

// ── Approvals pending count ───────────────────────────────────────────────────
app.get('/api/approvals/pending-count', requireAuth, async (req, res) => {
  // Via isAdminUser rather than re-reading roles here, so the owner gets the
  // badge too — the sidebar shows it, and a count of 0 would have told the
  // one account that can approve anything that there is nothing to approve.
  if (!isAdminUser(req.session?.user)) return res.json({ count:0 });
  try {
    if (USE_DB) {
      const [revise, tasks] = await Promise.all([
        q(`SELECT COUNT(*) AS cnt FROM delegations WHERE status='revise_requested'`),
        q(`SELECT COUNT(*) AS cnt FROM delegations WHERE approval='Approval Required' AND status='pending'`),
      ]);
      return res.json({ count:Number(revise[0]?.cnt||0)+Number(tasks[0]?.cnt||0) });
    }
    const store = await readStore();
    const dels = store.delegations||[];
    const count = dels.filter(d=>d.status==='revise_requested').length + dels.filter(d=>d.approval==='Approval Required'&&d.status==='pending').length;
    return res.json({ count });
  } catch { return res.json({ count:0 }); }
});

// ── Profile ───────────────────────────────────────────────────────────────────
app.patch('/api/profile', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.session?.user?.id;
    if (!id) return res.status(401).json({ error:'Not authenticated' });
    const body = req.body;
    try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT DEFAULT NULL'); } catch {}
    await pool.query(`UPDATE users SET name=COALESCE($1,name), email=COALESCE($2,email), phone=COALESCE($3,phone) WHERE id=$4`, [body.name??null,body.email??null,body.phone??null,id]);
    if (body.picture!==undefined) {
      await pool.query('UPDATE users SET picture=$1 WHERE id=$2', [body.picture,id]);
      // Only on a real upload — clearing the photo shouldn't archive anything.
      if (body.picture) safeUploadUserPhotoToDrive(body.pictureOriginal || body.picture, { userId: id, userName: body.name || req.session.user.name || '' });
    }
    if (body.notificationEmail!==undefined) {
      await pool.query(`INSERT INTO profile (user_id,notification_email) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET notification_email=$3`, [id,body.notificationEmail||'',body.notificationEmail||'']);
    }
    if (body.newPassword) {
      const [user] = await q('SELECT password_hash FROM users WHERE id = $1', [id]);
      if (!user) return res.status(404).json({ error:'User not found' });
      const currentOk = !user.password_hash ? body.currentPassword===DEFAULT_PASSWORD : await bcrypt.compare(body.currentPassword||'', user.password_hash);
      if (!currentOk) return res.status(400).json({ error:'Current password is incorrect' });
      const hash = await bcrypt.hash(body.newPassword, 10);
      await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash,id]);
    }
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Developer: access ─────────────────────────────────────────────────────────
app.get('/api/developer/access', async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error:'Unauthorized' });
  try {
    const { rows } = await pool.query(`SELECT "value" FROM app_config WHERE "key" = 'access_enabled'`);
    const enabled = !rows.length||rows[0].value!=='false';
    return res.json({ enabled });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.post('/api/developer/access', async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error:'Unauthorized' });
  const { enabled } = req.body;
  try {
    await pool.query(`INSERT INTO app_config ("key","value") VALUES ('access_enabled',$1) ON CONFLICT ("key") DO UPDATE SET "value"=$2`, [String(enabled),String(enabled)]);
    return res.json({ success:true, enabled });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Developer: reset ──────────────────────────────────────────────────────────
app.post('/api/developer/reset', async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error:'Unauthorized' });
  try {
    const backupId = await createBackup('Before Delete All Tasks').catch(()=>null);
    await pool.query('DELETE FROM checklist_completions');
    await pool.query('DELETE FROM delegations');
    await pool.query('DELETE FROM masters');
    return res.json({ success:true, backupId });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Developer: reset checklist masters only (leaves delegations + completion history intact) ──
app.post('/api/developer/reset-checklist', async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error:'Unauthorized' });
  try {
    const backupId = await createBackup('Before Delete All Checklist Tasks').catch(()=>null);
    await pool.query('DELETE FROM masters');
    return res.json({ success:true, backupId });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Developer: export ─────────────────────────────────────────────────────────
app.get('/api/developer/export', async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error:'Unauthorized' });
  try {
    const [delegations, users, masters, holidays] = await Promise.all([
      q(`SELECT id, description, doer, due_date AS due_date, client, status, priority, url, remarks, approval, delegated_by, created_at, completed_at, transferred_from, transferred_by FROM delegations ORDER BY created_at DESC`),
      q(`SELECT id, name, email, phone, department, roles, active, created_at FROM users ORDER BY name`),
      q(`SELECT id, task, assigned_to, frequency, created_at FROM masters`),
      q(`SELECT id, date, name, type FROM holidays ORDER BY date`),
    ]);
    return res.json({ delegations, users, masters, holidays });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Developer: backups ────────────────────────────────────────────────────────
app.get('/api/developer/backups', async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error:'Unauthorized' });
  try {
    await ensureBackupTable();
    await pool.query('DELETE FROM dev_backups WHERE expires_at < NOW()');
    const rows = await q('SELECT id, label, created_at, expires_at FROM dev_backups ORDER BY created_at DESC LIMIT 30');
    return res.json({ backups:rows });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Developer: restore ────────────────────────────────────────────────────────
app.post('/api/developer/restore', async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error:'Unauthorized' });
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error:'Backup ID required' });
    const rows = await q('SELECT data FROM dev_backups WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error:'Backup not found or expired' });
    const backup = JSON.parse(rows[0].data);
    await ensureSchema();
    await pool.query('DELETE FROM delegations');
    if (backup.delegations?.length) {
      for (const d of backup.delegations) {
        await pool.query(`INSERT INTO delegations (id,description,doer_id,doer,delegated_by,due_date,client,status,type,priority,approval,url,remarks,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status`,
          [d.id||'',d.description||'',d.doer_id||null,d.doer||'',d.delegated_by||null,d.due_date||null,d.client||'',['pending','done','revise','revise_requested','approval_pending'].includes(d.status)?d.status:'pending',d.type||'delegation',d.priority||'Low',d.approval||'No Approval',d.url||'',d.remarks||'',d.created_at||new Date()]
        ).catch(()=>{});
      }
    }
    await pool.query('DELETE FROM masters');
    if (backup.masters?.length) {
      for (const m of backup.masters) {
        await pool.query(`INSERT INTO masters (id,task,assigned_to,frequency,start_date,end_date,remarks,department,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET task=EXCLUDED.task`, [m.id,m.task||'',m.assigned_to||'',m.frequency||'Daily',m.start_date||null,m.end_date||null,m.remarks||'',m.department||'',m.created_at||new Date()]).catch(()=>{});
      }
    }
    await pool.query('DELETE FROM users');
    if (backup.users?.length) {
      for (const u of backup.users) {
        await pool.query(`INSERT INTO users (id,name,email,phone,department,roles,active,password_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`,
          [u.id||'',u.name||'',u.email||'',u.phone||'',u.department||'',u.roles||'User',u.active!=null?u.active:1,u.password_hash||null,u.created_at||new Date()]
        ).catch(()=>{});
      }
    }
    return res.json({ success:true });
  } catch (err) { console.error('[Restore]',err.message); return res.status(500).json({ error:err.message }); }
});

// ── Developer: reset-users ────────────────────────────────────────────────────
app.post('/api/developer/reset-users', async (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ error:'Unauthorized' });
  try {
    const { mode='all' } = req.body;
    await createBackup(`Before Delete Users (mode: ${mode})`).catch(()=>null);
    const NEW_ADMIN = { id:'U001', name:'Admin', email:'Admin@lal.com', password:'Admin@1234', roles:'Admin' };

    if (!USE_DB) {
      const store = await readStore();
      const isAdmin = u => { const r=Array.isArray(u.roles)?u.roles:String(u.roles||'').split(','); return r.map(x=>x.trim()).includes('Admin'); };
      if (mode==='users') store.users=(store.users||[]).filter(isAdmin);
      if (mode==='admins') store.users=(store.users||[]).filter(u=>!isAdmin(u));
      if (mode==='all') store.users=[];
      if (mode!=='users') {
        store.users.push({ id:NEW_ADMIN.id, name:NEW_ADMIN.name, email:NEW_ADMIN.email, phone:'', department:'Administration', roles:['Admin'], active:true, createdAt:new Date().toISOString() });
        await writeStore(store);
        return res.json({ success:true, admin:{ email:NEW_ADMIN.email, password:NEW_ADMIN.password } });
      }
      await writeStore(store);
      return res.json({ success:true });
    }

    if (mode==='users') {
      await pool.query("DELETE FROM users WHERE NOT ('Admin' = ANY(string_to_array(roles, ',')))");
      return res.json({ success:true });
    }
    if (mode==='admins') { await pool.query("DELETE FROM users WHERE 'Admin' = ANY(string_to_array(roles, ','))"); }
    else { await pool.query('DELETE FROM users'); }
    const hash = await bcrypt.hash(NEW_ADMIN.password, 10);
    await pool.query('INSERT INTO users (id,name,email,phone,department,roles,active,password_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7,NOW())', [NEW_ADMIN.id,NEW_ADMIN.name,NEW_ADMIN.email,'','Administration',NEW_ADMIN.roles,hash]);
    return res.json({ success:true, admin:{ email:NEW_ADMIN.email, password:NEW_ADMIN.password } });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Sync Sheets ───────────────────────────────────────────────────────────────
app.post('/api/sync-sheets', requireAuth, async (req, res) => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL||!process.env.GOOGLE_PRIVATE_KEY) return res.status(500).json({ error:'Google credentials not configured' });
  try {
    await ensureSchema();
    await syncUsers_gs();
    return res.json({ success:true, message:'All tabs synced to Google Sheets' });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Migrate ───────────────────────────────────────────────────────────────────
const MIGRATE_USERS = [
  {id:'U001',name:'Abhishek Jain',email:'abhishek@e-marketing.io',phone:'9602684444',department:'CXO',roles:'Admin',active:1},
  {id:'U002',name:'Akhilesh Vyas',email:'vyas.akhilesh@e-marketing.io',phone:'7048462985',department:'Business Automation',roles:'Admin,HOD',active:1},
  {id:'U003',name:'Akshita Jain',email:'jain.akshita@e-marketing.io',phone:'7340302359',department:'Social Media',roles:'User',active:1},
  {id:'U004',name:'Aman Bejal',email:'bejal.aman@e-marketing.io',phone:'6376724283',department:'Graphic Designing',roles:'User',active:1},
  {id:'U005',name:'Aman Pareek',email:'pareek.aman@e-marketing.io',phone:'7507905684',department:'Business Automation',roles:'Admin,User',active:1},
  {id:'U006',name:'Ankit Ladha',email:'ladha.ankit@e-marketing.io',phone:'7737270516',department:'Google Ads',roles:'User',active:1},
  {id:'U007',name:'Ashish Jha',email:'seo@e-marketing.io',phone:'9024736048',department:'SEO',roles:'User',active:1},
  {id:'U008',name:'Bhanu Sharma',email:'sharma.bhanu@e-marketing.io',phone:'9351842255',department:'SEO',roles:'User',active:1},
  {id:'U009',name:'Chetna Agrawal',email:'chetna@e-marketing.io',phone:'8238999732',department:'CXO',roles:'User',active:1},
  {id:'U010',name:'Ching Thakral',email:'googlexecutive@e-marketing.io',phone:'9988716423',department:'Google Ads',roles:'User',active:1},
  {id:'U011',name:'Divvy Jain',email:'jain.divvy@e-marketing.io',phone:'8769533770',department:'Meta Ads',roles:'User',active:1},
  {id:'U012',name:'Divya Srivastava',email:'srivastava.divya@e-marketing.io',phone:'9001798754',department:'Graphic Designing',roles:'User',active:1},
  {id:'U013',name:'Garvit Kedia',email:'kedia.garvit@e-marketing.io',phone:'9782800257',department:'Meta Ads',roles:'User',active:1},
  {id:'U014',name:'Gaurav Gupta',email:'gupta.gaurav@e-marketing.io',phone:'9155836021',department:'Website Design & Development',roles:'User',active:1},
  {id:'U015',name:'Harsh Daharwal',email:'daharwal.harsh@e-marketing.io',phone:'9596896449',department:'Business Automation',roles:'Admin,User',active:1},
  {id:'U016',name:'Kritika Saini',email:'saini.kritika@e-marketing.io',phone:'8696482750',department:'Google Ads',roles:'User',active:1},
  {id:'U017',name:'Kushagra Dubey',email:'dubey.kushagra@e-marketing.io',phone:'8203058282',department:'Meta Ads',roles:'User',active:1},
  {id:'U018',name:'Mohit Kumawat',email:'kumawat.mohit@e-marketing.io',phone:'6290552269',department:'Content Writing',roles:'User',active:1},
  {id:'U019',name:'Nikita Khandelwal',email:'khandelwal.nikita@e-marketing.io',phone:'8306660792',department:'MDO',roles:'Admin,User',active:1},
  {id:'U020',name:'Nisha Madaan',email:'madaan.nisha@e-marketing.io',phone:'9988820092',department:'Google Ads',roles:'User',active:1},
  {id:'U021',name:'Nupur Kothari',email:'kothari.nupur@e-marketing.io',phone:'9314050398',department:'Graphic Designing',roles:'User',active:1},
  {id:'U022',name:'Pradhuman Kumar',email:'pradhuman@e-marketing.io',phone:'7973006643',department:'Google Ads',roles:'HOD',active:1},
  {id:'U023',name:'Priya Saini',email:'saini.priya@e-marketing.io',phone:'9652295500',department:'SEO',roles:'User',active:1},
  {id:'U024',name:'Purvi Saini',email:'saini.purvi@e-marketing.io',phone:'9301878061',department:'MDO',roles:'Admin,User',active:1},
  {id:'U025',name:'Rahul Maharchandani',email:'maharchandani.rahul@e-marketing.io',phone:'8302671330',department:'AI',roles:'HOD',active:1},
  {id:'U026',name:'Ritu Tilokani',email:'tilokani.ritu@e-marketing.io',phone:'9772779351',department:'Content Writing',roles:'HOD',active:1},
  {id:'U027',name:'Sakshi Saini',email:'sakshi.saini@e-marketing.io',phone:'9530000022',department:'Google Ads',roles:'User',active:1},
  {id:'U028',name:'Satish Khichi',email:'khichi.satish@e-marketing.io',phone:'9530000023',department:'Google Ads',roles:'User',active:1},
  {id:'U029',name:'Saurav Pareek',email:'pareek.saurav@e-marketing.io',phone:'9530000024',department:'Social Media',roles:'User',active:1},
  {id:'U030',name:'Swati Joshi',email:'joshi.swati@e-marketing.io',phone:'9530000025',department:'Content Writing',roles:'User',active:1},
  {id:'U031',name:'Tushar Chauhan',email:'chauhan.tushar@e-marketing.io',phone:'9530000026',department:'Website Design & Development',roles:'User',active:1},
  {id:'U032',name:'Vishal Jaga',email:'mis1@e-marketing.io',phone:'00756492939',department:'MDO',roles:'Admin',active:1},
  {id:'U033',name:'Naman Gupta',email:'mis2@e-marketing.io',phone:'6367577176',department:'Business Automation',roles:'User',active:1,password_hash:'$2b$10$fF1PhyruhuhcYZtrqIC2DOjPlGZct61n/b9azuwsuRCSrpI4SKtD6'},
  {id:'U034',name:'Saloni',email:'saloni@lallubhaiamichand.com',phone:'',department:'CXO',roles:'Admin',active:1,password_hash:'$2b$10$I6naUIg8PYam1dg8ZCo3.uPvJ9BogTgTNrBy1l.wCJzMmUQQrw/3G'},
];

app.get('/api/migrate', async (req, res) => {
  const key = req.query.key;
  if (key!=='migrate-lallubhai-2026') return res.status(401).json({ error:'Unauthorized' });
  try {
    await ensureSchema();
    const results={ users:0, delegations:0, masters:0, holidays:0, errors:[] };
    for (const u of MIGRATE_USERS) {
      try {
        await pool.query(`INSERT INTO users (id,name,email,phone,department,roles,active,password_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,phone=EXCLUDED.phone,department=EXCLUDED.department,roles=EXCLUDED.roles,active=EXCLUDED.active,password_hash=COALESCE(EXCLUDED.password_hash,users.password_hash)`,
          [u.id,u.name,u.email,u.phone||'',u.department||'',u.roles,u.active,u.password_hash||null]);
        results.users++;
      } catch(e) { results.errors.push(`User ${u.id}: ${e.message}`); }
    }
    return res.json({ success:true, ...results });
  } catch(err) { return res.status(500).json({ error:err.message }); }
});

// ── DB test ───────────────────────────────────────────────────────────────────
app.get('/api/db-test', async (req, res) => {
  try {
    await ensureSchema();
    const rows = await q('SELECT COUNT(*) AS cnt FROM users');
    return res.json({ ok:true, users:Number(rows[0].cnt) });
  } catch (err) { return res.status(500).json({ ok:false, error:err.message, code:err.code }); }
});

// ── Setup passwords ───────────────────────────────────────────────────────────
app.get('/api/setup-passwords', async (req, res) => {
  try {
    await ensureSchema();
    const hash = await bcrypt.hash('India@123', 10);
    await pool.query('UPDATE users SET password_hash = $1', [hash]);
    const rows = await q('SELECT COUNT(*) AS c FROM users WHERE password_hash IS NOT NULL');
    return res.json({ ok:true, updated:Number(rows[0].c), password:'India@123' });
  } catch (err) { return res.status(500).json({ ok:false, error:err.message }); }
});

// ── Master control panel ──────────────────────────────────────────────────────
const MASTER_KEY = process.env.MASTER_KEY || 'emarketing-master-2026';

app.get('/api/master', async (req, res) => {
  const key = req.query.key;
  if (key!==MASTER_KEY) return res.status(401).json({ error:'Unauthorized' });
  await ensureSchema();
  const { rows } = await pool.query(`SELECT "value" FROM app_config WHERE "key" = 'app_active'`);
  const isActive = rows.length===0 ? true : rows[0].value==='true';
  const action = req.query.action;
  if (action==='disable') {
    await pool.query(`INSERT INTO app_config ("key","value") VALUES ('app_active','false') ON CONFLICT ("key") DO UPDATE SET "value"='false'`);
    return res.json({ success:true, app_active:false, message:'App DISABLED' });
  }
  if (action==='enable') {
    await pool.query(`INSERT INTO app_config ("key","value") VALUES ('app_active','true') ON CONFLICT ("key") DO UPDATE SET "value"='true'`);
    return res.json({ success:true, app_active:true, message:'App ENABLED' });
  }
  const html = `<!DOCTYPE html><html><head><title>Master Control Panel</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0;font-family:Inter,system-ui,sans-serif}body{background:#0f172a;color:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}.card{background:#1e293b;border:1px solid #334155;border-radius:1rem;padding:2rem;width:100%;max-width:420px}h1{font-size:1.25rem;font-weight:700;margin-bottom:.25rem}.sub{color:#94a3b8;font-size:.8rem;margin-bottom:2rem}.status{display:flex;align-items:center;gap:.75rem;padding:1rem;border-radius:.75rem;margin-bottom:1.5rem;font-weight:600}.status.on{background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);color:#34d399}.status.off{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#f87171}.dot{width:10px;height:10px;border-radius:50%}.dot.on{background:#34d399}.dot.off{background:#f87171}.btn{display:block;width:100%;padding:.875rem;border:none;border-radius:.75rem;font-size:.9rem;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;margin-bottom:.75rem}.btn-red{background:linear-gradient(135deg,#dc2626,#991b1b);color:white}.btn-green{background:linear-gradient(135deg,#059669,#065f46);color:white}.note{font-size:.75rem;color:#64748b;text-align:center;margin-top:1rem}</style></head><body><div class="card"><h1>Master Control Panel</h1><p class="sub">E-Marketing Task Manager</p><div class="status ${isActive?'on':'off'}"><span class="dot ${isActive?'on':'off'}"></span>App is currently <strong style="margin-left:4px">${isActive?'ACTIVE':'DISABLED'}</strong></div>${isActive?`<a href="?key=${MASTER_KEY}&action=disable" class="btn btn-red">Disable App</a>`:`<a href="?key=${MASTER_KEY}&action=enable" class="btn btn-green">Enable App</a>`}<p class="note">Keep this URL secret</p></div></body></html>`;
  res.setHeader('Content-Type','text/html');
  return res.send(html);
});

// ── Catch-all SPA ─────────────────────────────────────────────────────────────
// The shell references page scripts by a manually-bumped ?v=N — if this HTML
// response itself gets cached (by the browser or a CDN/proxy in front of the
// origin), a version bump in the file never reaches the browser because it
// never even re-requests app.html to see the new script tag. This route must
// never be cached.
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Seed JSON store with admin user if no users exist (fallback when DB unavailable)
async function seedJsonFallback() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  try {
    const store = await readStoreJson();
    if (store.users && store.users.length > 0) return;
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD, 10);
    store.users = [{
      id: 'A001', name: process.env.ADMIN_NAME || 'Admin',
      email: adminEmail, roles: ['Admin'], active: true,
      password_hash: hash, phone: '', department: '', picture: null,
    }];
    await writeStoreJson(store);
    console.log('[store] Admin user seeded in JSON store:', adminEmail);
  } catch (e) {
    console.error('[store] seedJsonFallback error:', e.message);
  }
}

app.listen(process.env.PORT || 3000, async () => {
  console.log('Server on http://localhost:' + (process.env.PORT || 3000));
  console.log('[google-sync] credentials present at boot — email:', !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, '| key:', !!process.env.GOOGLE_PRIVATE_KEY);
  await seedJsonFallback();
});
