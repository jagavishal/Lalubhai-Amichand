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
  `CREATE TABLE IF NOT EXISTS users (id VARCHAR(16) PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL, phone VARCHAR(64) DEFAULT '', department VARCHAR(128) DEFAULT '', roles VARCHAR(128) DEFAULT 'User', active SMALLINT NOT NULL DEFAULT 1, password_hash VARCHAR(255) DEFAULT NULL, picture TEXT DEFAULT NULL, force_logout_after DATETIME DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(name, email)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
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
  `CREATE TABLE IF NOT EXISTS meetings (id VARCHAR(16) PRIMARY KEY, title VARCHAR(255) NOT NULL, meeting_date DATE NOT NULL, start_time VARCHAR(10) DEFAULT NULL, end_time VARCHAR(10) DEFAULT NULL, attendees TEXT DEFAULT NULL, notes TEXT DEFAULT NULL, created_by VARCHAR(255) DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_mtg_date ON meetings (meeting_date)`,
  `CREATE TABLE IF NOT EXISTS leaves (id VARCHAR(16) PRIMARY KEY, user_id VARCHAR(16), user_name VARCHAR(255) NOT NULL, type VARCHAR(64) DEFAULT 'Leave', from_date DATE NOT NULL, to_date DATE NOT NULL, reason TEXT DEFAULT NULL, status VARCHAR(32) DEFAULT 'pending', approver VARCHAR(255) DEFAULT 'HOD', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_at DATETIME DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS daily_tasks (id VARCHAR(16) PRIMARY KEY, entry_date DATE NOT NULL, doer_id VARCHAR(16), doer VARCHAR(255) NOT NULL DEFAULT '', client VARCHAR(255) DEFAULT '', department VARCHAR(128) DEFAULT '', description TEXT DEFAULT NULL, minutes INT DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_dt_doer ON daily_tasks (doer_id)`,
  `CREATE INDEX idx_dt_date ON daily_tasks (entry_date)`,
  `CREATE TABLE IF NOT EXISTS clients (id VARCHAR(16) PRIMARY KEY, name VARCHAR(255) NOT NULL, contact_person VARCHAR(255) DEFAULT '', contact_number VARCHAR(64) DEFAULT '', email VARCHAR(255) DEFAULT '', industry VARCHAR(128) DEFAULT '', status VARCHAR(32) DEFAULT 'active', notes TEXT DEFAULT NULL, mobile VARCHAR(64) DEFAULT '', state VARCHAR(128) DEFAULT '', district VARCHAR(128) DEFAULT '', address TEXT DEFAULT NULL, pin VARCHAR(16) DEFAULT '', bank_name VARCHAR(255) DEFAULT '', account_holder VARCHAR(255) DEFAULT '', account_no VARCHAR(64) DEFAULT '', ifsc_code VARCHAR(32) DEFAULT '', branch_name VARCHAR(255) DEFAULT '', division VARCHAR(64) DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS dev_backups (id VARCHAR(64) PRIMARY KEY, label VARCHAR(128) NOT NULL DEFAULT '', data TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS user_sessions (sid VARCHAR(128) PRIMARY KEY, data TEXT NOT NULL, expires_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT NULL`,
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
];

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

async function fixCollations() {
  if (!USE_DB) return;
  const tables = ['users','delegations','masters','clients','checklist_completions','daily_tasks','leaves','user_sessions'];
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
    // These two must be awaited, not fire-and-forget: g.__pg_schema_ready is cached
    // and returned instantly to every future ensureSchema() caller the moment this
    // IIFE resolves, so an un-awaited background fix here would race every request
    // that runs before it happens to finish (e.g. collation-dependent JOINs failing
    // intermittently right after a cold start).
    await fixCollations().catch((e) => console.error('[db] fixCollations failed:', e.message));
    await relaxEmailUnique().catch((e) => console.error('[db] relaxEmailUnique failed:', e.message));
  })();
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
  const df = doerFilter ? doerFilter.trim().toLowerCase() : '';
  if (filter==='all'||filter==='delegation') {
    (store.delegations||[]).forEach(d => {
      if (df && (d.doer||'').trim().toLowerCase() !== df) return;
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
      if (df && (m.assignedTo||'').trim().toLowerCase() !== df) return;
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
    const values = rows.map(u => [u.id,u.name,u.email,u.phone||'',u.department||'',(Array.isArray(u.roles)?u.roles:[u.roles]).filter(Boolean).join(', '),u.active?'Yes':'No',u.created_at?new Date(u.created_at).toLocaleString('en-IN'):'']);
    const meta = await sheets.spreadsheets.get({ spreadsheetId:SPREADSHEET_ID });
    const exists = meta.data.sheets.some(s=>s.properties.title==='Users');
    if (!exists) await sheets.spreadsheets.batchUpdate({ spreadsheetId:SPREADSHEET_ID, requestBody:{requests:[{addSheet:{properties:{title:'Users'}}}]} });
    await sheets.spreadsheets.values.update({ spreadsheetId:SPREADSHEET_ID, range:'Users!A1', valueInputOption:'RAW', requestBody:{values:[['ID','Name','Email','Phone','Department','Roles','Active','Created At']]} });
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
    pool.query(
      `CREATE TABLE IF NOT EXISTS user_sessions (sid VARCHAR(128) PRIMARY KEY, data TEXT NOT NULL, expires_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ).catch(() => {});
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
  set(sid, sess, cb) {
    const exp = new Date(Date.now() + SESSION_TTL_MS);
    const data = JSON.stringify(sess);
    pool.query(
      `INSERT INTO user_sessions (sid, data, expires_at) VALUES ($1,$2,$3) ON CONFLICT (sid) DO UPDATE SET data=$4, expires_at=$5`,
      [sid, data, exp, data, exp]
    ).then(() => cb(null)).catch(() => cb(null));
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
app.use(session({
  store: USE_DB ? new DbSessionStore() : undefined,
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
  const roles = req.session?.user?.roles || [];
  const rolesArr = Array.isArray(roles) ? roles : String(roles).split(',').map(r=>r.trim());
  if (!rolesArr.includes('Admin') && !rolesArr.includes('HOD')) return res.status(403).json({ error: 'Forbidden' });
  next();
}

function isAdminUser(user) {
  const roles = user?.roles || [];
  const rolesArr = Array.isArray(roles) ? roles : String(roles).split(',').map(r=>r.trim());
  return rolesArr.includes('Admin') || rolesArr.includes('HOD');
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
    return res.json({ user: { ...req.session.user, picture: user.picture || null, featureFlags: { fms: FMS_ENABLED } } });
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
    return res.json({ user: { ...u, picture, permissions, featureFlags: { fms: FMS_ENABLED } } });
  } catch {
    return res.json({ user: { ...u, featureFlags: { fms: FMS_ENABLED } } });
  }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', requireAuth, async (req, res) => {
  const store = await readStore();
  const user = req.session.user;
  const roles = Array.isArray(user.roles) ? user.roles : String(user.roles||'').split(',').map(r=>r.trim());
  const isAdminUser = roles.includes('Admin') || roles.includes('HOD');
  // Non-admins only ever see their own tasks — ignore any doer they pass in,
  // admins can filter by any doer (or leave it blank to see everyone's).
  const doer = isAdminUser ? (req.query.doer || '') : (user.name || '');
  const result = computeDashboard(store, 'all', doer);

  if (FMS_ENABLED) {
    try {
      // Mirror the same doer-scoping computeDashboard just applied above: an admin
      // viewing "everyone" sees every pending FMS step, but an admin drilled into one
      // specific employee's dashboard (?doer=) should see only that employee's steps too.
      let fmsUserId = user.id, fmsUserName = user.name, fmsIsAdmin = isAdminUser;
      if (isAdminUser && doer) {
        const target = (store.users || []).find(u => (u.name || '').trim().toLowerCase() === doer.trim().toLowerCase());
        fmsUserId = target ? target.id : null;
        fmsUserName = doer;
        fmsIsAdmin = false;
      }
      const fmsTasks = (fmsIsAdmin || fmsUserId) ? await fmsSheet.getMyFmsPendingRows({ userId: fmsUserId, userName: fmsUserName, isAdmin: fmsIsAdmin }) : [];
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
    const userDept = sessUser?.department || '';
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
      else if (isHOD) {
        const teamNames = new Set((store.users || []).filter(u => (u.department || '') === userDept).map(u => (u.name || '').toLowerCase()));
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
      sqlWhere = `WHERE doer_id IN (SELECT id FROM users WHERE department=$1) OR doer_id=$2 OR LOWER(doer)=LOWER($3) OR delegated_by=$4`;
      params.push(userDept, userId, userName, userId);
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
  const uRows = await q('SELECT email, name FROM users WHERE id=$1 OR email=$1 LIMIT 1', [delegatorId]);
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
    const joined = {
      vendors: Array.isArray(vendors) ? vendors.join(', ') : (vendors || ''),
      department: Array.isArray(department) ? department.join(', ') : (department || ''),
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
        joined.department, department_other || '',
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
        joined.department, department_other || '',
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
  const userName = (sessUser?.name || '').trim().toLowerCase();
  const userDept = sessUser?.department || '';
  if (!USE_DB) {
    const store = await readStore();
    let rows = store.masters||[];
    if (isHOD) {
      const teamNames = new Set((store.users || []).filter(u => (u.department || '') === userDept).map(u => (u.name || '').trim().toLowerCase()));
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
    const teamRows = await q('SELECT LOWER(TRIM(name)) AS n FROM users WHERE department=$1', [userDept]);
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
    const department = body.department || '';
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
      if (body.department !== undefined) m.department=body.department;
      await writeStore(store);
      return res.json({ success:true });
    }
    await ensureSchema();
    const before = await q('SELECT assigned_to, task FROM masters WHERE id=$1', [body.id]);
    const prevAssignee = before[0]?.assigned_to || '';
    const assignedTo = body.assignedTo !== undefined ? body.assignedTo.trim() : undefined;
    await pool.query('UPDATE masters SET task=COALESCE($1,task), assigned_to=COALESCE($2,assigned_to), frequency=COALESCE($3,frequency), start_date=COALESCE($4,start_date), end_date=COALESCE($5,end_date), remarks=COALESCE($6,remarks), department=COALESCE($7,department) WHERE id=$8', [body.task??null,assignedTo??null,body.frequency??null,body.startDate??null,body.endDate??null,body.remarks??null,body.department??null,body.id]);
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

// ── Daily Tasks ───────────────────────────────────────────────────────────────
app.get('/api/daily-tasks', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const doerId = req.query.doerId;
    const rows = doerId
      ? await q(`SELECT id, entry_date AS entryDate, doer_id AS doerId, doer, client, department, description, minutes, created_at AS createdAt FROM daily_tasks WHERE doer_id=$1 ORDER BY entry_date DESC, created_at DESC`, [doerId])
      : await q(`SELECT id, entry_date AS entryDate, doer_id AS doerId, doer, client, department, description, minutes, created_at AS createdAt FROM daily_tasks ORDER BY entry_date DESC, created_at DESC`);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.post('/api/daily-tasks', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const body = req.body;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!body.entryDate||!body.doer||rows.length===0) return res.status(400).json({ error:'entryDate, doer and at least one row required' });
    const c = await q('SELECT COUNT(*) AS cnt FROM daily_tasks');
    let n = Number(c[0].cnt);
    for (const r of rows) {
      n+=1;
      const id = 'DT'+n.toString().padStart(5,'0');
      await pool.query('INSERT INTO daily_tasks (id,entry_date,doer_id,doer,client,department,description,minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id,body.entryDate,body.doerId||null,body.doer,r.client||'',r.department||'',r.description||'',Number(r.minutes)||0]);
    }
    return res.status(201).json({ success:true, inserted:rows.length });
  } catch (err) { return res.status(500).json({ error:err.message }); }
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
          store.users.push({ id, name, email, phone:row.phone||'', department:row.department||'', roles, active:true, password_hash:hash, permissions: defaultPermissionsFor(roles), createdAt:new Date().toISOString() });
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
          await pool.query('INSERT INTO users (id,name,email,phone,department,roles,active,password_hash,permissions,created_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,NOW())', [id,name,email,row.phone||'',row.department||'',roles.join(','),hash,perms?JSON.stringify(perms):null]);
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
    const newUser = { id, name:body.name.trim(), email:body.email.trim(), phone:body.phone||'', department:body.department||'', roles, active:true, permissions: defaultPermissionsFor(roles), createdAt:new Date().toISOString() };
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
    await pool.query('INSERT INTO users (id,name,email,phone,department,roles,active,password_hash,permissions,created_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,NOW())', [id,body.name.trim(),body.email.trim().toLowerCase(),body.phone||'',body.department||'',roles.join(','),hash,perms?JSON.stringify(perms):null]);
    if (body.picture) {
      try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT DEFAULT NULL'); } catch {}
      await pool.query('UPDATE users SET picture=$1 WHERE id=$2', [body.picture,id]);
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
      if (body.department!==undefined) user.department=body.department;
      if (body.roles!==undefined) user.roles=Array.isArray(body.roles)?body.roles:body.roles.split(',').map(r=>r.trim());
      if (body.active!==undefined) user.active=body.active;
      if (body.permissions!==undefined) user.permissions=body.permissions;
      await writeStore(store);
      return res.json(user);
    }
    await ensureSchema();
    const roles = body.roles ? (Array.isArray(body.roles)?body.roles.join(','):body.roles) : null;
    await pool.query(
      `UPDATE users SET name=COALESCE($1,name), email=COALESCE($2,email), phone=COALESCE($3,phone), department=COALESCE($4,department), roles=COALESCE($5,roles), active=COALESCE($6,active) WHERE id=$7`,
      [body.name??null,body.email??null,body.phone??null,body.department??null,roles,body.active===undefined?null:(body.active?1:0),body.id]
    );
    if (body.picture!==undefined) {
      try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT DEFAULT NULL'); } catch {}
      await pool.query('UPDATE users SET picture=$1 WHERE id=$2', [body.picture,body.id]);
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

// ── Holidays ──────────────────────────────────────────────────────────────────
app.get('/api/holidays', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { rows } = await pool.query('SELECT id, date, name, type FROM holidays ORDER BY date ASC');
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.post('/api/holidays', requireAuth, async (req, res) => {
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

app.delete('/api/holidays', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error:'id required' });
    await pool.query('DELETE FROM holidays WHERE id = $1', [id]);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Meetings ──────────────────────────────────────────────────────────────────
app.get('/api/meetings', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { from, to } = req.query;
    const rows = (from&&to)
      ? await q(`SELECT id, title, meeting_date AS date, start_time AS startTime, end_time AS endTime, attendees, notes, created_by AS createdBy FROM meetings WHERE meeting_date BETWEEN $1 AND $2 ORDER BY meeting_date ASC, start_time ASC`, [from,to])
      : await q(`SELECT id, title, meeting_date AS date, start_time AS startTime, end_time AS endTime, attendees, notes, created_by AS createdBy FROM meetings ORDER BY meeting_date ASC, start_time ASC`);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.post('/api/meetings', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const body = req.body;
    if (!body.title?.trim()||!body.date) return res.status(400).json({ error:'title and date required' });
    const c = await q('SELECT COUNT(*) AS cnt FROM meetings');
    const id = 'MTG'+(Number(c[0].cnt)+1).toString().padStart(4,'0');
    await pool.query('INSERT INTO meetings (id,title,meeting_date,start_time,end_time,attendees,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id,body.title.trim(),body.date,body.startTime||null,body.endTime||null,body.attendees||'',body.notes||'',body.createdBy||'']);
    return res.status(201).json({ success:true, id });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.delete('/api/meetings', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error:'id required' });
    await pool.query('DELETE FROM meetings WHERE id = $1', [id]);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Leaves ────────────────────────────────────────────────────────────────────
app.get('/api/leaves', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const userId = req.query.userId;
    const rows = userId
      ? await q(`SELECT id, user_id AS userId, user_name AS userName, type, from_date AS fromDate, to_date AS toDate, reason, status, approver, created_at AS createdAt, decided_at AS decidedAt FROM leaves WHERE user_id=$1 ORDER BY created_at DESC`, [userId])
      : await q(`SELECT id, user_id AS userId, user_name AS userName, type, from_date AS fromDate, to_date AS toDate, reason, status, approver, created_at AS createdAt, decided_at AS decidedAt FROM leaves ORDER BY created_at DESC`);
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

app.patch('/api/leaves', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureSchema();
    const body = req.body;
    if (!body.id||!body.status) return res.status(400).json({ error:'id and status required' });
    await pool.query('UPDATE leaves SET status=$1, decided_at=NOW() WHERE id=$2', [body.status,body.id]);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── FMS (Flow Management System) API — see fmsSheet.js wiring further down,
// registered once getGoogleAuth()/ensureLogTab() etc. exist (search "FMS routes").

// ── Clients ───────────────────────────────────────────────────────────────────
app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const rows = await q(`SELECT id, name, mobile, contact_number, email, state, district, address, pin, status, bank_name, account_holder, account_no, ifsc_code, branch_name, division, created_at AS createdAt FROM clients ORDER BY created_at DESC`);
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
      `INSERT INTO clients (id,name,mobile,email,state,district,address,pin,status,bank_name,account_holder,account_no,ifsc_code,branch_name,division)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, b.name.trim(), b.mobile||'', b.email||'', b.state||'', b.district||'', b.address||'', b.pin||'',
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
      `UPDATE clients SET name=COALESCE($1,name), mobile=COALESCE($2,mobile), email=COALESCE($3,email),
       state=COALESCE($4,state), district=COALESCE($5,district), address=COALESCE($6,address), pin=COALESCE($7,pin),
       status=COALESCE($8,status), bank_name=COALESCE($9,bank_name), account_holder=COALESCE($10,account_holder),
       account_no=COALESCE($11,account_no), ifsc_code=COALESCE($12,ifsc_code), branch_name=COALESCE($13,branch_name),
       division=COALESCE($14,division)
       WHERE id=$15`,
      [b.name??null, b.mobile??null, b.email??null, b.state??null, b.district??null, b.address??null, b.pin??null,
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
const MONITORING_TAB_NAME = 'Monitoring';
// PR creation also logs into the existing FMS (Stores) tracking spreadsheet —
// a separate, pre-existing sheet the store team already tracks PRs in by hand.
const PR_MONITORING_SHEET_ID = '1AX0lB5eyUgh5RHbAv1D5mllTQyV8B9SadnPsltfLang';

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

app.get('/api/fms', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const user = req.session.user;
    const admin = isAdminUser(user);
    const sheets = await fmsSheet.getFmsSheetsWithStats(user.id, admin);
    return res.json(sheets);
  } catch (err) { return res.status(500).json({ error: err.message }); }
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
    });
    return res.status(201).json(sheet);
  } catch (err) { return res.status(500).json({ error: err.message }); }
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
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get('/api/fms/sheet-column-values', requireAdmin, fmsGate, async (req, res) => {
  try {
    const { sheetUrlOrId, tabName, colLetter, headerRow } = req.query;
    if (!sheetUrlOrId || !tabName || !colLetter) return res.status(400).json({ error: 'sheetUrlOrId, tabName and colLetter required' });
    await ensureSchema();
    const result = await fmsSheet.sheetColumnValues(sheetUrlOrId, tabName, colLetter, headerRow || 1);
    return res.json(result);
  } catch (err) { return res.status(500).json({ error: err.message }); }
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
  } catch (err) { return res.status(500).json({ error: err.message }); }
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
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get('/api/fms/:id/intake-fields', requireAdmin, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const sheet = await fmsSheet.getFmsSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    const fields = await fmsSheet.getIntakeFields(req.params.id);
    return res.json({ sheet, fields });
  } catch (err) { return res.status(500).json({ error: err.message }); }
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
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get('/api/fms/:id', requireAdmin, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const sheet = await fmsSheet.getFmsSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    const steps = await fmsSheet.getFullSteps(req.params.id);
    return res.json({ ...sheet, steps });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.put('/api/fms/:id', requireAdmin, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    const sheet = await fmsSheet.updateFmsSheet(req.params.id, {
      fmsName: b.fmsName || '', sheetName: b.sheetName || '', sheetId: b.sheetId || '',
      headerRow: b.headerRow || 1, steps: b.steps || [], processCoordinatorId: b.processCoordinatorId || null,
    });
    return res.json(sheet);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.delete('/api/fms/:id', requireAdmin, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    await fmsSheet.deleteFmsSheet(req.params.id);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: err.message }); }
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
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get('/api/fms-tasks/:id/intake', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const sheet = await fmsSheet.getFmsSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    const fields = await fmsSheet.getIntakeFields(req.params.id);
    return res.json({ sheet: { id: sheet.id, fms_name: sheet.fms_name, intake_form_name: sheet.intake_form_name }, fields });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post('/api/fms-tasks/:id/intake', requireAuth, fmsGate, async (req, res) => {
  try {
    await ensureSchema();
    const sheet = await fmsSheet.getFmsSheet(req.params.id);
    if (!sheet) return res.status(404).json({ error: 'Not found' });
    const fields = await fmsSheet.getIntakeFields(req.params.id);
    const result = await fmsSheet.submitIntakeRow(sheet, fields, req.body.values || {}, { userName: req.session.user.name });
    return res.status(201).json(result);
  } catch (err) { return res.status(400).json({ error: err.message }); }
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
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: err.message }); }
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
  } catch (err) { return res.status(500).json({ error: err.message }); }
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

async function syncPrToSheet(id) {
  if (!getGoogleAuth()) return;
  try {
    const pr = await fetchPrForPdf(id);
    if (!pr) return;
    const buffer = await buildPrPdfBuffer(pr);
    const pdfLink = await safeUploadPdfToDrive(buffer, id + '.pdf');
    const total = (pr.items || []).reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.estimatedRate) || 0), 0);
    const header = ['PR ID', 'Type', 'Date', 'Requested By', 'Department', 'Vendor', 'Items Summary', 'Est. Total', 'Status', 'PDF Link'];
    await ensureLogTab(PR_SHEET_ID, LOG_TAB_NAME, header);
    await appendLogRow(PR_SHEET_ID, LOG_TAB_NAME, [
      pr.id, PR_TYPE_LABEL[pr.prType] || pr.prType, pr.prDate, pr.requestedBy || '', pr.department || '',
      pr.vendorName || '', _itemsSummary(pr.items), total.toFixed(2), pr.status || '', pdfLink || '',
    ]);
    console.log('[google-sync] PR sync: row appended for', pr.id);
  } catch (e) { console.error('[google-sync] PR sync failed:', e.message); }
}

// Separate from syncPrToSheet above — this appends into the store team's own
// pre-existing FMS (Stores) tracking spreadsheet, which already has PR rows
// entered by hand and many product-specific columns we don't own. Only ever
// append into the known-existing "Monitoring" tab; never create/re-header it.
async function syncPrToMonitoringSheet(id) {
  if (!getGoogleAuth()) return;
  try {
    const pr = await fetchPrForPdf(id);
    if (!pr) { console.error('[google-sync] PR monitoring sync: PR not found for id', id); return; }
    const timestamp = _timestampForSheet();
    await appendLogRow(PR_MONITORING_SHEET_ID, MONITORING_TAB_NAME, [timestamp, pr.id, pr.requestedBy || '', pr.vendorName || '']);
    console.log('[google-sync] PR monitoring sync: row appended for', pr.id, 'to', PR_MONITORING_SHEET_ID);
  } catch (e) { console.error('[google-sync] PR monitoring sync failed:', e.message); }
}

async function syncPoToSheet(id) {
  if (!getGoogleAuth()) return;
  try {
    const po = await fetchPoForPdf(id);
    if (!po) return;
    const buffer = await buildPoPdfBuffer(po);
    const pdfLink = await safeUploadPdfToDrive(buffer, id + '.pdf');
    const subtotal = (po.items || []).reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0), 0);
    const gst = (po.items || []).reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0) * (parseFloat(it.gstPercent) || 0) / 100, 0);
    const freight = parseFloat(po.freightCharges) || 0, packing = parseFloat(po.packingCharges) || 0, discount = parseFloat(po.discount) || 0;
    const total = subtotal + gst + freight + packing - discount;
    const header = ['PO ID', 'Type', 'Date', 'PR No', 'Created By', 'Department', 'Vendor', 'Items Summary', 'Subtotal', 'GST', 'Freight', 'Packing', 'Discount', 'Total', 'Approval Status', 'PDF Link'];
    await ensureLogTab(PO_MONITORING_SHEET_ID, MONITORING_TAB_NAME, header);
    await appendLogRow(PO_MONITORING_SHEET_ID, MONITORING_TAB_NAME, [
      po.id, PO_TYPE_LABEL[po.poType] || po.poType, po.poDate, po.prId || '', po.createdBy || '', po.department || '',
      po.vendorName || '', _itemsSummary(po.items), subtotal.toFixed(2), gst.toFixed(2), freight.toFixed(2), packing.toFixed(2), discount.toFixed(2), total.toFixed(2),
      po.approvalStatus || '', pdfLink || '',
    ]);
    console.log('[google-sync] PO sync: row appended for', po.id);
  } catch (e) { console.error('[google-sync] PO sync failed:', e.message); }
}

async function syncGrnToSheet(id) {
  if (!getGoogleAuth()) return;
  try {
    const gr = await fetchGrForPdf(id);
    if (!gr) return;
    const buffer = await buildGrnPdfBuffer(gr);
    const pdfLink = await safeUploadPdfToDrive(buffer, id + '.pdf');
    const subtotal = (gr.items || []).reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0), 0);
    const cgst = parseFloat(gr.cgst) || 0, sgst = parseFloat(gr.sgst) || 0, roundOff = parseFloat(gr.roundOff) || 0;
    const total = subtotal + cgst + sgst + roundOff;
    const header = ['GR No', 'Date', 'Made By', 'PR No', 'PO No', 'Bill No', 'Bill Recv Date', 'Dept Head', 'Vendor', 'Items Summary', 'Subtotal', 'CGST', 'SGST', 'Round Off', 'Total', 'PDF Link'];
    await ensureLogTab(GRN_SHEET_ID, LOG_TAB_NAME, header);
    await appendLogRow(GRN_SHEET_ID, LOG_TAB_NAME, [
      gr.id, gr.grDate, gr.madeBy || '', gr.prId || '', gr.poId || '', gr.billNo || '', gr.billRecvDate || '', gr.deptHead || '',
      gr.vendorName || '', _itemsSummary(gr.items), subtotal.toFixed(2), cgst.toFixed(2), sgst.toFixed(2), roundOff.toFixed(2), total.toFixed(2), pdfLink || '',
    ]);
    console.log('[google-sync] GRN sync: row appended for', gr.id);
  } catch (e) { console.error('[google-sync] GRN sync failed:', e.message); }
}

// ── PO Creation (fills the store team's live "PO July 2026" Google Sheet directly —
// that sheet IS the database here, nothing is mirrored locally). Each of the 3
// tabs below is a reusable template: submitting a PO overwrites it with the new
// PO's data, exports that tab as a PDF (Drive-hosted), and logs the PO in the
// "ERP PO Log" tab — the template itself stays put, ready for the next PO.
const PO_CREATION_SHEET_ID = '1QB4fZQ1IVFeGs9YKXgGb-dAvsVrTQnBjPCEBzyd0KrM';
const PO_CREATION_LOG_TAB = 'ERP PO Log';

// Fixed dropdown list backing the sheet's own Department data-validation rule
// (Vendor Details!N3:N31 on the PurchaseOrder/Diamond PO tabs).
const PO_DEPARTMENTS = [
  'Press Shop', 'Accessories', 'Fitting', 'Spinning', 'Milk Jug Fitting', 'Washing', 'Packing',
  'Tool Room', 'Store', 'Time Keeper', 'Cnc', 'Circles', 'Riveting Department', 'ST STEEL', 'PRESSING', 'ALU CIRCLE',
];

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
      const n = parseInt(row[0], 10);
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
// only), departments (the sheet's own Department dropdown list), and the next
// PO number — all read live off the sheet (no local mirror).
app.get('/api/po-creation/masters', requireAuth, async (req, res) => {
  try {
    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });
    const [vendorsRes, shipToRes, deptRes, meta] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range: `'Vendor Details'!A2:E200`, valueRenderOption: 'FORMATTED_VALUE' }),
      sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range: `'Vendor Details'!I3:I45`, valueRenderOption: 'FORMATTED_VALUE' }),
      sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range: `'Vendor Details'!N3:N31`, valueRenderOption: 'FORMATTED_VALUE' }),
      _poSheetMeta(),
    ]);
    const vendors = (vendorsRes.data.values || []).filter(r => r[0]).map(r => r[0]);
    const shipToLocations = (shipToRes.data.values || []).filter(r => r[0]).map(r => r[0]);
    const departments = (deptRes.data.values || []).filter(r => r[0]).map(r => r[0]);
    return res.json({ vendors, shipToLocations, departments: departments.length ? departments : PO_DEPARTMENTS, nextPoNumber: meta.nextPoNo });
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
    const matches = (q ? rows.filter(r => r.code.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) : rows).slice(0, 50);
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
async function _exportSheetTabPdf(spreadsheetId, sourceSheetId) {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`
    + `?format=pdf&gid=${sourceSheetId}&size=A4&portrait=true&fitw=true`
    + `&gridlines=false&printtitle=false&sheetnames=false`
    + `&top_margin=0.3&bottom_margin=0.3&left_margin=0.3&right_margin=0.3`;
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
    const { date, prNo, department, party, shipTo, deliverySchedule, poValidity, paymentTerms, poMadeBy, items, summary } = req.body;
    if (!date || !party || !poMadeBy) return res.status(400).json({ error: 'Date, ' + cfg.partyLabel + ' and PO Made By are required' });
    const cleanItems = (Array.isArray(items) ? items : []).filter(it => it && String(it.itemCode || '').trim());
    if (!cleanItems.length) return res.status(400).json({ error: 'Add at least one item' });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    const { nextPoNo, sheetIdByTitle } = await _poSheetMeta();
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
    put(cfg.header.poNo, nextPoNo);
    put(cfg.header.date, date);
    put(cfg.header.prNo, prNo);
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
      pdfLink = await safeUploadPdfToDrive(pdfBuffer, `PO ${nextPoNo} - ${tab}.pdf`, PO_PDF_DRIVE_FOLDER_ID);
    } catch (e) { console.error('[po-creation] PDF export failed:', e.message); }

    // 5) Log this PO so the ERP can list it (the sheet is still the database —
    // this is just another tab in it, same pattern as the existing Monitoring/
    // Web App Log tabs already used elsewhere in this app).
    const sessUser = req.session?.user;
    await ensureLogTab(PO_CREATION_SHEET_ID, PO_CREATION_LOG_TAB, ['PO No', 'Format', 'Date', 'Party', 'Department', 'Total Amount (INR)', 'PDF Link', 'Created By', 'Created At']);
    await appendLogRow(PO_CREATION_SHEET_ID, PO_CREATION_LOG_TAB, [
      // Leading "'" forces the ISO date to stay literal text instead of being
      // reparsed into a locale-formatted date — the PO List page's date-range
      // filter compares these as plain "YYYY-MM-DD" strings.
      nextPoNo, tab, "'" + date, party, department || '', totalAmount ?? '', pdfLink || '', sessUser?.name || '', _timestampForSheet(),
    ]);

    return res.json({ success: true, poNumber: nextPoNo, totalAmount, pdfLink });
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
    const result = await sheets.spreadsheets.values.get({ spreadsheetId: PO_CREATION_SHEET_ID, range: `'${PO_CREATION_LOG_TAB}'!A2:I1000`, valueRenderOption: 'FORMATTED_VALUE' });
    const rows = (result.data.values || []).filter(r => r[0]).map(r => ({
      poNo: r[0] || '', format: r[1] || '', date: r[2] || '', party: r[3] || '', department: r[4] || '',
      total: r[5] || '', pdfLink: r[6] || '', createdBy: r[7] || '', createdAt: r[8] || '',
    })).reverse();
    return res.json(rows.slice(0, 200));
  } catch (e) {
    // No PO has been created via the ERP yet — the log tab doesn't exist.
    if (/unable to parse range/i.test(e.message || '')) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
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
      const n = parseInt(row[0], 10);
      if (!isNaN(n)) maxPrNo = Math.max(maxPrNo, n);
    }
  } catch (e) {
    if (!/unable to parse range/i.test(e.message || '')) console.error('[pr-creation] log read for numbering failed:', e.message);
  }
  return { nextPrNo: maxPrNo + 1, sheetIdByTitle };
}

// Same borrowed docs.google.com export approach as _exportPoTabPdf — no per-tab
// PDF export exists in the documented Sheets/Drive API.
async function _exportPrTabPdf(sourceSheetId) {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const url = `https://docs.google.com/spreadsheets/d/${PR_CREATION_SHEET_ID}/export`
    + `?format=pdf&gid=${sourceSheetId}&size=A4&portrait=true&fitw=true`
    + `&gridlines=false&printtitle=false&sheetnames=false`
    + `&top_margin=0.3&bottom_margin=0.3&left_margin=0.3&right_margin=0.3`;
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
    const [vendorsRes, meta] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: PR_CREATION_SHEET_ID, range: `'Vendor Name'!A3:A1000`, valueRenderOption: 'FORMATTED_VALUE' }),
      _prSheetMeta(),
    ]);
    const vendors = (vendorsRes.data.values || []).filter(r => r[0]).map(r => r[0]);
    return res.json({ vendors, nextPrNumber: meta.nextPrNo });
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
    const matches = (q ? rows.filter(r => r.code.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) : rows).slice(0, 50);
    return res.json(matches);
  } catch (e) { return res.status(500).json({ error: e.message }); }
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
      department, termsOfPayment, estimatedDelDate, dateRequested, items,
    } = req.body;
    const party = vendorName || partyName || '';
    if (!requestedBy || !party) return res.status(400).json({ error: 'Requested By and ' + cfg.partyLabel + ' are required' });
    const cleanItems = (Array.isArray(items) ? items : []).filter(it => it && String(it.itemCode || '').trim());
    if (!cleanItems.length) return res.status(400).json({ error: 'Add at least one item' });

    const auth = getGoogleAuth();
    if (!auth) return res.status(500).json({ error: 'Google Sheets is not configured on this server' });
    const { google } = require('googleapis');
    const sheets = google.sheets({ version: 'v4', auth });

    const { nextPrNo, sheetIdByTitle } = await _prSheetMeta();
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
    put(cfg.header.prNo, nextPrNo);
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
    // for the 3 auto-derived formats — the formula-derived Department, for the log.
    let totalAmount = null, departmentOut = department || '';
    try {
      const deptCell = cfg.header.department ? null : cfg.departmentCell;
      const ranges = [`'${tab}'!${cfg.summary.totalCell}`];
      if (deptCell) ranges.push(`'${tab}'!${deptCell}`);
      const readRes = await sheets.spreadsheets.values.batchGet({ spreadsheetId: PR_CREATION_SHEET_ID, ranges, valueRenderOption: 'UNFORMATTED_VALUE' });
      totalAmount = readRes.data.valueRanges?.[0]?.values?.[0]?.[0] ?? null;
      if (deptCell) departmentOut = readRes.data.valueRanges?.[1]?.values?.[0]?.[0] ?? '';
    } catch (e) { console.error('[pr-creation] total/department read-back failed:', e.message); }

    // 4) Export this fill as a PDF and save it to Drive — a Drive hiccup must
    // never block the PR itself from being created.
    let pdfLink = null;
    try {
      const pdfBuffer = await _exportPrTabPdf(sourceSheetId);
      pdfLink = await safeUploadPdfToDrive(pdfBuffer, `PR ${nextPrNo} - ${tab}.pdf`, PR_PDF_DRIVE_FOLDER_ID);
    } catch (e) { console.error('[pr-creation] PDF export failed:', e.message); }

    // 5) Log this PR so the ERP can list it — the sheet is still the database,
    // this is just another tab in it, same pattern as PO Creation's own log.
    const sessUser = req.session?.user;
    await ensureLogTab(PR_CREATION_SHEET_ID, PR_CREATION_LOG_TAB, ['PR No', 'Format', 'Date', 'Vendor/Party', 'Requested By', 'Department', 'Total Amount (INR)', 'PDF Link', 'Created By', 'Created At']);
    await appendLogRow(PR_CREATION_SHEET_ID, PR_CREATION_LOG_TAB, [
      nextPrNo, tab, dateRequested || '', party, requestedBy, departmentOut, totalAmount ?? '', pdfLink || '', sessUser?.name || '', _timestampForSheet(),
    ]);

    return res.json({ success: true, prNumber: nextPrNo, totalAmount, department: departmentOut, pdfLink });
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
    const result = await sheets.spreadsheets.values.get({ spreadsheetId: PR_CREATION_SHEET_ID, range: `'${PR_CREATION_LOG_TAB}'!A2:J1000`, valueRenderOption: 'FORMATTED_VALUE' });
    const rows = (result.data.values || []).filter(r => r[0]).map(r => ({
      prNo: r[0] || '', format: r[1] || '', date: r[2] || '', party: r[3] || '', requestedBy: r[4] || '',
      department: r[5] || '', total: r[6] || '', pdfLink: r[7] || '', createdBy: r[8] || '', createdAt: r[9] || '',
    })).reverse();
    return res.json(rows.slice(0, 200));
  } catch (e) {
    // No PR has been created via the ERP yet — the log tab doesn't exist.
    if (/unable to parse range/i.test(e.message || '')) return res.json([]);
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
// inspection, 2026-07-29). Columns C:H on each item row are an ARRAYFORMULA
// spill anchored at C6:H6 (VLOOKUP against item_code by Item No.) — never
// write to them, they populate automatically once Item No. (B) is written.
// Column L per row is a REAL per-row formula (=I*K), unlike PO's spill-driven
// amount columns — clearing it would delete the formula for good, so the
// clear step below only ever touches B (item no.) and I:K (qty/uom/rate).
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
  billNo: 'G4', billRecvDate: 'H4', deptHead: 'I4', date: 'L4',
};
const GRN_ITEMS = { firstRow: 7, lastRow: 26, itemNoCol: 'B', qtyCol: 'I', uomCol: 'J', rateCol: 'K' };
const GRN_SUMMARY_CELLS = { cgst: 'L28', sgst: 'L29', roundOff: 'L30' };
const GRN_COMMENTS_CELL = 'B28';
const GRN_SUBTOTAL_CELL = 'L27';
const GRN_TOTAL_CELL = 'L31';

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

// GET /api/grn-creation/items?q=... — item-no typeahead. Reuses PO
// Creation's own item catalog cache (_loadPoItemCatalog) since the GRN
// sheet's item_code tab is an IMPORTRANGE of the exact same PO ITEM_CODES
// range — no separate cache needed.
app.get('/api/grn-creation/items', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = await _loadPoItemCatalog('PurchaseOrder');
    const matches = (q ? rows.filter(r => r.code.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) : rows).slice(0, 50);
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
      put(`${GRN_ITEMS.qtyCol}${row}`, it.qty);
      put(`${GRN_ITEMS.uomCol}${row}`, it.uom);
      put(`${GRN_ITEMS.rateCol}${row}`, it.rate);
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
      const pdfBuffer = await _exportSheetTabPdf(GRN_CREATION_SHEET_ID, sourceSheetId);
      pdfLink = await safeUploadPdfToDrive(pdfBuffer, `GR ${nextGrNo}.pdf`, GRN_PDF_DRIVE_FOLDER_ID);
    } catch (e) { console.error('[grn-creation] PDF export failed:', e.message); }

    // 5) Log this GRN so the ERP can list it — same pattern as "ERP PO Log".
    const sessUser = req.session?.user;
    await ensureLogTab(GRN_CREATION_SHEET_ID, GRN_CREATION_LOG_TAB, ['GR No', 'Date', 'Made By', 'PR No', 'Vendor Name', 'PO No', 'Bill No', 'Total Amount (INR)', 'PDF Link', 'Created By', 'Created At']);
    await appendLogRow(GRN_CREATION_SHEET_ID, GRN_CREATION_LOG_TAB, [
      // Leading "'" forces the ISO date to stay literal text instead of being
      // reparsed into a locale-formatted date — same convention as ERP PO Log.
      nextGrNo, "'" + date, madeBy, prNo || '', vendorName, poNo || '', billNo || '', totalAmount ?? '', pdfLink || '', sessUser?.name || '', _timestampForSheet(),
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
    const result = await sheets.spreadsheets.values.get({ spreadsheetId: GRN_CREATION_SHEET_ID, range: `'${GRN_CREATION_LOG_TAB}'!A2:K1000`, valueRenderOption: 'FORMATTED_VALUE' });
    const rows = (result.data.values || []).filter(r => r[0]).map(r => ({
      grNo: r[0] || '', date: r[1] || '', madeBy: r[2] || '', prNo: r[3] || '', vendorName: r[4] || '',
      poNo: r[5] || '', billNo: r[6] || '', total: r[7] || '', pdfLink: r[8] || '', createdBy: r[9] || '', createdAt: r[10] || '',
    })).reverse();
    return res.json(rows.slice(0, 200));
  } catch (e) {
    // No GRN has been created via the ERP yet — the log tab doesn't exist.
    if (/unable to parse range/i.test(e.message || '')) return res.json([]);
    return res.status(500).json({ error: e.message });
  }
});

// ── Payment Entries ───────────────────────────────────────────────────────────

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
    const cnt = await q('SELECT COUNT(*) AS c FROM payment_entries');
    let base = Number(cnt[0]?.c || 0);
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
    const cnt = await q('SELECT COUNT(*) AS c FROM payment_entries');
    let base = Number(cnt[0]?.c || 0);
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
  } catch (err) { return res.status(500).json({ error: err.message }); }
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

// ── MIS ───────────────────────────────────────────────────────────────────────
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'}) : '—';

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
      if (type==='Checklist MIS') {
        const masters=store.masters||[]; const empMap={};
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
    if (type==='Checklist MIS') {
      const [masters, completions] = await Promise.all([
        q('SELECT id, task, assigned_to, frequency FROM masters ORDER BY assigned_to, id'),
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
  const roles = req.session?.user?.roles||[];
  const rolesArr = Array.isArray(roles)?roles:String(roles).split(',').map(r=>r.trim());
  const isAdmin = rolesArr.includes('Admin')||rolesArr.includes('HOD');
  if (!isAdmin) return res.json({ count:0 });
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
    if (body.picture!==undefined) await pool.query('UPDATE users SET picture=$1 WHERE id=$2', [body.picture,id]);
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
