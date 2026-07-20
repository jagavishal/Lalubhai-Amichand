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
const FMS_ENABLED = false;

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
  // table.column in upsert → bare column
  t = t.replace(/\b[a-z_]+\.([a-z_]+)\b/g, '$1');
  // ON CONFLICT (...) DO NOTHING → INSERT IGNORE
  if (/ON CONFLICT\s*\([^)]+\)\s*DO NOTHING/i.test(t)) {
    t = t.replace(/\bINSERT INTO\b/i, 'INSERT IGNORE INTO');
    t = t.replace(/\s*ON CONFLICT\s*\([^)]+\)\s*DO NOTHING/gi, '');
  }
  // ON CONFLICT (...) DO UPDATE SET → ON DUPLICATE KEY UPDATE
  t = t.replace(/ON CONFLICT\s*\([^)]+\)\s*DO UPDATE SET\s*/gi, 'ON DUPLICATE KEY UPDATE ');
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
  `CREATE TABLE IF NOT EXISTS fms (id VARCHAR(16) PRIMARY KEY, client_name VARCHAR(255) NOT NULL, platforms TEXT, mobile VARCHAR(64) DEFAULT '', doer VARCHAR(255) DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS fms_steps (fms_id VARCHAR(16) NOT NULL, step_index INT NOT NULL, planned DATETIME DEFAULT NULL, actual DATETIME DEFAULT NULL, PRIMARY KEY (fms_id, step_index), CONSTRAINT fk_fms_steps FOREIGN KEY (fms_id) REFERENCES fms(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
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
  `CREATE TABLE IF NOT EXISTS packing_items (id VARCHAR(24) PRIMARY KEY, item_type VARCHAR(32) NOT NULL DEFAULT 'PACKING_BOX', item_name VARCHAR(255) NOT NULL DEFAULT '', size_label VARCHAR(128) DEFAULT '', pcs_per_box VARCHAR(32) DEFAULT '', length_in VARCHAR(32) DEFAULT '', width_in VARCHAR(32) DEFAULT '', height_in VARCHAR(32) DEFAULT '', ply_type VARCHAR(64) DEFAULT '', product_code VARCHAR(64) DEFAULT '', barcode VARCHAR(64) DEFAULT '', cbm_per_box VARCHAR(32) DEFAULT '', customer_group VARCHAR(64) DEFAULT '', remarks VARCHAR(255) DEFAULT '', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `ALTER TABLE packing_items ADD COLUMN IF NOT EXISTS item_type VARCHAR(32) NOT NULL DEFAULT 'PACKING_BOX'`,
  `CREATE INDEX idx_pk_group ON packing_items (customer_group)`,
  `CREATE INDEX idx_pk_type ON packing_items (item_type)`,
  `CREATE TABLE IF NOT EXISTS purchase_requisitions (id VARCHAR(16) PRIMARY KEY, pr_type VARCHAR(32) NOT NULL DEFAULT 'ITEM_CODE', pr_date DATE NOT NULL, requested_by VARCHAR(255) NOT NULL DEFAULT '', requested_by_id VARCHAR(16) DEFAULT NULL, vendor_id VARCHAR(16) DEFAULT NULL, status VARCHAR(32) NOT NULL DEFAULT 'pending', expected_date DATE DEFAULT NULL, remarks TEXT DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS pr_type VARCHAR(32) NOT NULL DEFAULT 'ITEM_CODE'`,
  `ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS expected_date DATE DEFAULT NULL`,
  `CREATE INDEX idx_pr_status ON purchase_requisitions (status)`,
  `CREATE INDEX idx_pr_requester ON purchase_requisitions (requested_by_id)`,
  `CREATE INDEX idx_pr_type ON purchase_requisitions (pr_type)`,
  `CREATE TABLE IF NOT EXISTS purchase_requisition_items (id VARCHAR(24) PRIMARY KEY, pr_id VARCHAR(16) NOT NULL, packing_item_id VARCHAR(24) DEFAULT NULL, item_name VARCHAR(255) NOT NULL DEFAULT '', unit VARCHAR(32) DEFAULT '', quantity DECIMAL(12,2) DEFAULT 0, estimated_rate DECIMAL(12,2) DEFAULT 0, remarks VARCHAR(255) DEFAULT '') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_pri_pr ON purchase_requisition_items (pr_id)`,
];

// Seed rows for packing_items — imported once from "PR July 2026" packing-box
// spec sheet. Columns: id, item_name, size_label, pcs_per_box, length_in,
// width_in, height_in, ply_type, product_code, barcode, cbm_per_box,
// customer_group, remarks.
const SEED_PACKING_ITEMS = [
  ['PAC-B-01','NEW MILK JUG BRIGHT -11"','11','36','22.50','18.25','13.75','','','8906124180104','0.09252','',''],
  ['PAC-B-02','NEW MILK JUG BRIGHT -13"','13','24','24.50','20.25','11.25','','','8906124180111','0.09146','',''],
  ['PAC-B-03','NEW MILK JUG BRIGHT -15"','15','24','23.00','20.00','18.00','','','8906124180128','0.13568','',''],
  ['PAC-B-04','NEW MILK JUG BRIGHT -17"','17','12','22.50','19.50','12.75','','','8906124180135','0.09167','',''],
  ['PAC-B-05','NEW MILK JUG BRIGHT -20"','20','12','24.75','23.50','16.50','','','8906124180364','0.15726','',''],
  ['PAC-B-06','MANDI TOP/WITH/BAS.CO-18"','18','4','21.50','21.50','6.75','','','','0.05113','',''],
  ['PAC-B-07','MANDI TOP/WITH/BAS.CO-20"','20','4','24.50','24.50','7.25','','','','0.07131','',''],
  ['PAC-B-08','MANDI TOP/WITH/BAS.CO-22"','22','2','26.25','13.25','7.25','','','','0.04132','',''],
  ['PAC-B-09','MANDI TOP/WITH/BAS.CO-24"','24','2','28.75','14.25','8.75','','','','0.05874','',''],
  ['PAC-B-10','MANDI TOP/WITH/BAS.CO-26"','26','1','16.00','16.00','8.50','','','','0.03566','',''],
  ['PAC-B-11','BOYA (RICESTRAINER)-10','10','25','8.50','8.50','10.75','','','','0.01273','',''],
  ['PAC-B-12','BOYA (RICESTRAINER)-13','13','25','11.00','11.00','10.75','','','','0.02132','',''],
  ['PAC-B-13','BOYA (RICESTRAINER)-15','15','25','11.75','11.75','11.75','','','','0.02658','',''],
  ['PAC-B-14','BOYA (RICESTRAINER)-17','17','25','13.00','13.00','11.00','','','','0.03046','',''],
  ['PAC-B-15','BOYA (RICESTRAINER)-19','19','10','14.50','14.50','10.00','','','','0.03445','',''],
  ['PAC-B-16','ZARA/WITH/PIPE HDL-10"','10','12','14.50','14.50','8.00','','','','0.02756','',''],
  ['PAC-B-17','ZARA/WITH/PIPE HDL-11"','11','12','17.00','17.00','8.00','','','','0.03789','',''],
  ['PAC-B-18','ZARA/WITH/PIPE HDL-12"','12','12','17.50','17.50','9.00','','','','0.04517','',''],
  ['PAC-B-19','ZARA/WITH/SMALL HDL-NO.5"','5','40','7.50','21.50','14.00','','','','0.03699','',''],
  ['PAC-B-20','LADDLE/WITH/LONG HDL-NO.6"','6','24','22.75','18.25','11.00','','','','0.07484','',''],
  ['PAC-B-21','LADDLE/WITH/LONG HDL-NO.8"','8','24','25.00','19.00','12.00','','','','0.09341','',''],
  ['PAC-B-22','LADDLE/WITH/LONG HDL-NO.10"','10','24','25.75','19.75','15.00','','','','0.12501','',''],
  ['PAC-B-23','ZARA/WITH/LONG HDL - NO-7"','7','40','35.50','7.50','7.50','','','','0.03272','',''],
  ['PAC-B-24','BOTTLE - 10"','10','12','15.75','11.75','8.25','','','','0.02502','',''],
  ['PAC-B-25','BOTTLE - 12"','12','12','18.00','13.75','9.00','','','','0.03650','',''],
  ['PAC-B-26','BOTTLE - 16"','16','12','24.00','18.50','13.75','','','','0.10004','',''],
  ['PAC-B-27','Kettle-8','8','24','15.25','12.25','8.50','','','8906124180012','0.02602','',''],
  ['PAC-B-28','Kettle-9','9','24','18.50','13.50','9.25','','','8906124181118','0.03786','',''],
  ['PAC-B-29','Kettle-10','10','24','21.50','15.00','11.00','','','8906124180029','0.05813','',''],
  ['PAC-B-30','Kettle-11','11','24','22.75','17.00','11.75','','','8906124180159','0.07447','',''],
  ['PAC-B-31','Kettle-12','12','24','24.50','18.50','12.50','','','8906124180043','0.09284','',''],
  ['PAC-B-32','Kettle-13','13','24','27.25','20.25','12.75','','','8906124180166','0.11529','',''],
  ['PAC-B-33','Kettle-14','14','24','28.25','21.50','13.25','','','8906124180036','0.13188','',''],
  ['PAC-B-34','Kettle-15','15','24','31.50','22.50','14.00','','','8906124180173','0.16260','',''],
  ['PAC-B-35','Kettle-16','16','24','32.00','24.00','15.00','','','8906124180050','0.18878','',''],
  ['PAC-B-36','Kettle-17','17','12','19.00','19.00','23.00','','','8906124180180','0.13606','',''],
  ['PAC-B-37','Kettle-18','18','12','19.25','19.25','23.00','','','8906124180067','0.13967','',''],
  ['PAC-B-38','Kettle-20','20','12','21.00','21.00','25.50','','','8906124180074','0.18428','',''],
  ['PAC-B-39','Kettle-22','22','12','23.00','23.00','28.50','','','8906124180081','0.24706','',''],
  ['PAC-B-40','BASURAI TOP WITH COVER-9X18 (10 PCS)','9X18','1','11.00','11.00','12.00','','','','0.02379','',''],
  ['PAC-B-41','BASURAI TOP WITH COVER-9X15 (14 PCS SET 14G. )','9X15','1','9.25','9.25','10.00','','','','0.01402','',''],
  ['PAC-B-42','BASURAI TOP WITH COVER-9X23  18 G. (30 PCS SET)','9X23','1','13.50','13.50','15.50','','','890612480227','0.04629','',''],
  ['PAC-B-43','BASURAI TOP WITH COVER-12X20 (18 PCS SET) 18.G.','12X20','1','12.00','12.00','12.50','','','','0.02950','',''],
  ['PAC-B-44','BASURAI TOP WITH COVER-9X23 RIM POLISH (15 PCS)','9X23','1','13.50','13.50','15.50','','','','0.04629','',''],
  ['PAC-B-45','SCREW BARNI-10','10','24','18.75','14.00','13.00','','','','0.05592','',''],
  ['PAC-B-46','SCREW BARNI-12','12','24','20.75','16.00','14.75','','','','0.08025','',''],
  ['PAC-B-47','SCREW BARNI-14','14','24','24.50','18.25','16.75','','','','0.12273','',''],
  ['PAC-B-48','SCREW BARNI-16','16','12','22.00','14.50','18.25','','','','0.09540','',''],
  ['PAC-B-49','SCREW BARNI-18','18','12','24.50','18.00','20.00','','','','0.14453','',''],
  ['PAC-B-50','SCREW BARNI-20','20','12','27.00','20.00','21.50','','','','0.19025','',''],
  ['PAC-B-51','SCREW BARNI-24','24','8','23.00','23.00','26.00','','','','0.22539','',''],
  ['PAC-B-52','SCREW BARNI-28','28','4','25.00','25.00','16.00','','','','0.16387','',''],
  ['PAC-B-53','NAXI KADI DABA-10','10','36','23.50','18.00','13.50','','','','0.09358','',''],
  ['PAC-B-54','NAXI KADI DABA-12','12','36','28.00','21.00','14.75','','','','0.14213','',''],
  ['PAC-B-55','NAXI KADI DABA-14','14','24','32.00','24.50','11.00','','','','0.14132','',''],
  ['PAC-B-56','MOGLAI KATORA (NAXI)-18X22 (3 PCS)','18X22','1','28.00','28.00','12.75','','','','0.16381','',''],
  ['PAC-B-57','MOGLAI KATORA (NAXI)-22X26 (3 PCS)','22X26','1','32.00','32.00','20.00','','','','0.33561','',''],
  ['PAC-B-58','Round Tray with Design / Polish','30','12','13.00','13.00','3.75','','','','0.01039','',''],
  ['PAC-B-59','Round Tray with Design / Polish','35','12','15.00','15.00','3.75','','','','0.01383','',''],
  ['PAC-B-60','Round Tray with Design / Polish','40','12','16.00','16.00','3.75','','','','0.01573','',''],
  ['PAC-B-61','Round Tray with Design / Polish','50','12','20.25','20.25','5.00','','','','0.03360','',''],
  ['PAC-B-62','Golden Round Kettle','10 (1.0L)','24.00','23.50','17.00','10.00','','','','0.06547','',''],
  ['PAC-B-63','Golden Round Kettle','12 (1.5L)','24.00','27.00','20.00','11.75','','','','0.10398','',''],
  ['PAC-B-64','Golden Round Kettle','14 (2.0L)','18.00','23.50','23.50','13.50','','','','0.12217','',''],
  ['PAC-B-65','Golden Round Kettle','16 (4.0L)','18.00','25.00','25.00','14.50','','','','0.14851','',''],
  ['PAC-B-66','BASURAI TOP WITH COVER-9X23  14 G.(30 PCS SET)','9X23','1','13.50','13.50','15.50','','','','0.04629','',''],
  ['PAC-B-67','NEW MILK JUG BRIGHT -11"  (24 PCS)','11','24','27.75','18.25','8.00','','','','0.06639','',''],
  ['PAC-B-68','KETTLE PLATE','15','-','31.50','22.50','2MM','','','','#VALUE!','',''],
  ['PAC-B-69','KETTLE PLATE','16','-','32.00','24.00','2MM','','','','#VALUE!','',''],
  ['PAC-B-70','KETTLE','30','4','30.00','30.00','12.25','','','','0.18067','',''],
  ['PAC-B-71','KETTLE','32','4','32.00','32.00','13.00','','','','0.21814','',''],
  ['PAC-B-72','NAXI KADI DABBA','16','','33.50','16.75','9.00','','','','0.08276','',''],
  ['PAC-B-73','SCREW BARNI','16','12','18.25','18.25','20.00','','','','0.10916','',''],
  ['PAC-B-74','BUSRAI TOPE WITH COVER (10,13,17,21)','10,13,17,21','1','12.60','12.60','8.00','','','','0.02081','',''],
  ['PAC-B-75','BUSRAI TOPE WITH COVER (12,17,21)','12,17,21','1','12.60','12.60','8.00','','','','0.02081','',''],
  ['PAC-B-76','NAXI KADI DABBA (6)','6','120','17.00','15.00','19.00','','','7 ply','0.07940','',''],
  ['PAC-B-77','NEW MILK JUG BRIGHT-13','13','24','24.50','20.25','11.25','','','','0.09146','',''],
  ['PAC-B-78','NEW MILK JUG BRIGHT-15','15','24','23.00','20.00','18.00','','','','0.13568','',''],
  ['PAC-B-79','NEW MILK JUG BRIGHT-17','17','12','22.50','19.50','12.75','','','','0.09167','',''],
  ['PAC-B-80','NEW MILK JUG BRIGHT-20','20','12','24.50','23.50','16.25','','','','0.15332','',''],
  ['PAC-B-81','Milk Jug Ring Type','13','24','24.50','20.25','11.25','','','','0.09146','',''],
  ['PAC-B-82','Milk Jug Ring Type','15','24','23.00','20.00','18.00','','','','0.13568','',''],
  ['PAC-B-83','Milk Jug Ring Type','17','12','22.50','19.50','12.75','','','','0.09167','',''],
  ['PAC-B-84','Milk Jug Ring Type','20','12','24.50','23.50','16.25','','','','0.15332','',''],
  ['PAC-B-85','Modern Milk Jug (Bakelite Handle & Knob)','11','12','13.50','13.50','13.00','','','6287043663551','0.03883','',''],
  ['PAC-B-86','Modern Milk Jug (Bakelite Handle & Knob)','13','12','25.00','17.25','9.50','','','6287043663568','0.06714','',''],
  ['PAC-B-87','Modern Milk Jug (Bakelite Handle & Knob)','15','12','27.00','20.00','10.00','','','6287043663575','0.08849','',''],
  ['PAC-B-88','Round Kettle','10','24','23.50','17.00','10.00','','','6287043663582','0.06547','',''],
  ['PAC-B-89','Round Kettle','12','24','27.00','20.00','11.25','','','6287043663599','0.09955','',''],
  ['PAC-B-90','Round Kettle','14','24','33.50','24.00','13.00','','','6287043663605','0.17128','',''],
  ['PAC-B-91','Round Kettle','16','24','34.50','25.00','14.00','','','6287043663612','0.19787','',''],
  ['PAC-B-92','Screw Barni - Plain','10','24','18.75','14.00','14.00','','','6287043663629','0.06022','',''],
  ['PAC-B-93','Screw Barni - Plain','12','24','20.75','16.00','14.75','','','6287043663636','0.08025','',''],
  ['PAC-B-94','Screw Barni - Plain','14','12','24.50','18.50','8.50','','','6287043663643','0.06313','',''],
  ['PAC-B-95','Screw Bami - Plain','16','12','22.00','14.50','18.25','','','6287043663650','0.09540','',''],
  ['PAC-B-96','Screw Barni - Plain','18','12','24.50','18.00','20.00','','','6287043663667','0.14453','',''],
  ['PAC-B-97','Tawa (As Supplied to Naseer Al-Hoimadi)','35cm','6','14.25','15.75','2.50','','','','0.00919','',''],
  ['PAC-B-98','Tawa (As Supplied to Naseer Al-Hoimadi )','40cm','6','15.75','17.75','2.50','','','','0.01145','',''],
  ['PAC-B-99','Tawa (As Supplied 10 Naseer Al-Hoimadi)','45cm','6','17.75','19.75','2.50','','','','0.01436','',''],
  ['PAC-B-100','Tawa (As Supplied 10 Nasecr Al-Hoimadi )','50cm','6','19.75','21.75','2.50','','','','0.01760','',''],
  ['PAC-B-101','Busrai Tope With Cover - 8 pcs set','10,13, 17,21','1','12.60','12.60','8.00','','','','0.02081','',''],
  ['PAC-B-102','Busrai Tope With Cover - 6 pcs set','12,17,21','1','12.60','12.60','8.00','','','','0.02081','',''],
  ['PAC-B-103','Busrai Tope With Cover Â·30pcs set (14 G.)','9X23','1','13.50','13.50','15.50','','','','0.04629','',''],
  ['PAC-B-104','Mandi Tope With Busrai Cover','18','4','21.50','21.50','6.75','','','','0.05113','',''],
  ['PAC-B-105','Mandi Tope With Busrai Cover','20','4','24.50','24.50','7.25','','','','0.07131','',''],
  ['PAC-B-106','Mandi Tope With Busrai Cover','22','2','26.25','13.25','7.25','','','','0.04132','',''],
  ['PAC-B-107','Mandi Tope With Busrai Cover','24','2','28.75','14.25','8.75','','','','0.05874','',''],
  ['PAC-B-108','Mandi Tope With Busrai Cover','26','1','16.00','16.00','8.00','','','','0.03356','',''],
  ['PAC-B-109','Round Tray - Naxi','30','12','12.50','12.50','3.50','','','','0.00896','',''],
  ['PAC-B-110','Round Tray - Naxi','35','12','14.50','14.50','4.00','','','','0.01378','',''],
  ['PAC-B-111','Round Tray â¢ Naxi','40','12','17.00','17.00','4.50','','','','0.02131','',''],
  ['PAC-B-112','Round TrayÂ· Naxi','45','12','19.00','19.00','5.00','','','','0.02958','',''],
  ['PAC-B-113','Round Tray - Naxi','50','12','21.00','21.00','5.00','','','','0.03613','',''],
  ['PAC-B-114','Round Tray - INaxi','55','12','22.50','22.50','5.50','','','','0.04563','',''],
  ['PAC-B-115','Rectangular TrayÂ·Naxi','No.1','12','11.75','14.50','5.00','','','','0.01396','',''],
  ['PAC-B-116','Rectangular TrayÂ·Naxi','No.2','12','14.50','19.50','5.25','','','','0.02433','','2ND TIME UPDATE'],
  ['PAC-B-117','Rectangular TrayÂ·Naxi','No.3','12','16.75','21.50','5.50','','','','0.03246','',''],
  ['PAC-B-118','Rectangular TrayÂ·Naxi','No.4','6','18.75','23.75','3.75','','','','0.02737','',''],
  ['PAC-B-119','Modern Milk Jug (Alu. Casting Handle & Knob)','11','12','16.25','15.50','11.25','','','','0.04643','',''],
  ['PAC-B-120','Modern Milk Jug (Alu. Casting Handle & Knob)','13','12','19.50','18.50','11.50','','','','0.06798','',''],
  ['PAC-B-121','Modern Milk Jug (Alu. Casting Handle & Knob)','15','12','20.50','20.50','14.50','','','','0.09986','',''],
  ['PAC-B-122','Modern Kettle','12','12','20.00','15.50','11.00','','','','0.05588','',''],
  ['PAC-B-123','Modern Kettle','14','12','24.00','16.50','13.50','','','','0.08761','',''],
  ['PAC-B-124','Modern Kettle','16','6','25.00','19.00','7.50','','','','0.05838','',''],
  ['PAC-B-125','HMD Cooking Pot w/2 Side Hinges Handle','17X25 (3PCS) (17,21,25)','1','14.00','14.00','10.50','','','','0.03372','',''],
  ['PAC-B-126','HMD Cooking Pot w/2 Side Hinges Handle','14X26 (4PCS)','1','14.50','14.50','10.50','','','','0.03618','',''],
  ['PAC-B-127','Naxi Langri Busrai Tope','9X15 (7PCS)','1','9.25','9.25','8.75','','','','0.01227','',''],
  ['PAC-B-128','Plain Rectangle Tray','No.1','12','11.75','14.50','5.00','','','','0.01396','MIDDLE EAST',''],
  ['PAC-B-129','Plain Rectangle Tray','No.2','12','14.50','18.75','5.25','','','','0.02339','MIDDLE EAST',''],
  ['PAC-B-130','Plain Rectangle Tray','No.3','12','16.75','21.50','5.50','','','','0.03246','MIDDLE EAST',''],
  ['PAC-B-131','Plain Rectangle Tray','No.4','6','18.75','23.75','3.75','','','','0.02737','MIDDLE EAST',''],
  ['PAC-B-132','Naxi Rectangle Tray','No.1','12','11.75','14.50','5.00','','','','0.01396','MIDDLE EAST',''],
  ['PAC-B-133','Naxi Rectangle Tray','No.2','12','14.50','18.75','5.25','','','','0.02339','MIDDLE EAST',''],
  ['PAC-B-134','Naxi Rectangle Tray','No.4','6','18.75','23.75','3.75','','','','0.02737','MIDDLE EAST',''],
  ['PAC-B-135','Naxi Rectangle Tray','No.5','6','20.50','26.75','4.50','','','','0.04044','MIDDLE EAST',''],
  ['PAC-B-136','Kettle Plain with Netter Handle (s type spout)','6','48','14.25','14.25','11.00','7 ply','','','0.03660','MIDDLE EAST',''],
  ['PAC-B-137','Kettle Plain with Netter Handle (s type spout)','7','48','15.00','15.00','12.00','7 ply','','','0.04425','MIDDLE EAST',''],
  ['PAC-B-138','Kettle Plain with Netter Handle (s type spout)','8','48','15.50','15.50','12.50','7 ply','','','0.04921','MIDDLE EAST',''],
  ['PAC-B-139','Kettle Plain with Netter Handle (s type spout)','9','48','18.25','18.25','15.00','7 ply','','','0.08187','MIDDLE EAST',''],
  ['PAC-B-140','Kettle Plain with Netter Handle (s type spout)','10','24','21.50','15.00','11.00','7 ply','','','0.05813','MIDDLE EAST',''],
  ['PAC-B-141','Kettle Plain with Netter Handle (s type spout)','11','24','22.75','17.00','11.75','7 ply','','','0.07447','MIDDLE EAST',''],
  ['PAC-B-142','Kettle Plain with Netter Handle (s type spout)','12','24','24.50','18.50','12.75','7 ply','','','0.09470','MIDDLE EAST',''],
  ['PAC-B-143','Kettle Plain with Netter Handle (s type spout)','13','24','27.25','20.25','12.50','7 ply','','','0.11303','MIDDLE EAST',''],
  ['PAC-B-144','Kettle Plain with Netter Handle (s type spout)','14','24','28.50','21.50','13.50','7 ply','','','0.13556','MIDDLE EAST',''],
  ['PAC-B-145','Kettle Plain with Netter Handle (s type spout)','15','24','31.50','22.50','14.50','7 ply','','','0.16841','MIDDLE EAST',''],
  ['PAC-B-146','Kettle Plain with Netter Handle (s type spout)','18','18','28.50','28.50','16.00','7 ply','','','0.21297','MIDDLE EAST',''],
  ['PAC-B-147','Kettle Plain with Netter Handle (s type spout)','20','12','21.50','21.50','25.50','7 ply','','','0.19316','MIDDLE EAST',''],
  ['PAC-B-148','Naxi Dabba Sada','10','36','23.50','18.00','13.00','','','','0.09011','MIDDLE EAST',''],
  ['PAC-B-149','Naxi Dabba Sada','12','36','28.00','21.00','14.00','','','','0.13490','MIDDLE EAST',''],
  ['PAC-B-150','Naxi Dabba Sada','14','24','32.00','24.50','10.00','','','','0.12847','MIDDLE EAST',''],
  ['PAC-B-151','New Milk Jug Bright','11','24','27.25','17.50','8.00','sp 5 ply','','','0.06252','MIDDLE EAST',''],
  ['PAC-B-152','New Milk Jug Bright','13','24','24.50','20.25','11.25','','','','0.09146','MIDDLE EAST',''],
  ['PAC-B-153','New Milk Jug Bright','15','24','23.00','20.00','18.00','','','','0.13568','MIDDLE EAST',''],
  ['PAC-B-154','New Milk Jug Bright','17','12','22.50','20.50','12.75','','','','0.09637','MIDDLE EAST',''],
  ['PAC-B-155','New Milk Jug Ring Type Bright','11','24','27.25','17.50','8.00','sp 5 ply','','','0.06252','MIDDLE EAST',''],
  ['PAC-B-156','New Milk Jug Ring Type Bright','13','24','24.50','20.25','11.25','','','','0.09146','MIDDLE EAST',''],
  ['PAC-B-157','New Milk Jug Ring Type Bright','15','24','23.00','20.00','18.00','','','','0.13568','MIDDLE EAST',''],
  ['PAC-B-158','Screw Barni','10','24','18.75','14.00','14.00','','','','0.06022','MIDDLE EAST',''],
  ['PAC-B-159','Screw Barni','12','24','20.75','16.00','14.75','','','','0.08025','MIDDLE EAST',''],
  ['PAC-B-160','Screw Barni','14','24','24.50','18.25','16.75','','','','0.12273','MIDDLE EAST',''],
  ['PAC-B-161','BUSRAI TOPE (KUWAITI LID)','13x22','1','','','','','','','0.00000','MIDDLE EAST',''],
  ['PAC-B-162','MODERN KETTLE','12','12','20.00','15.50','11.00','','','','0.05588','MIDDLE EAST',''],
  ['PAC-B-163','MODERN KETTLE','14','12','24.00','16.50','13.50','','','','0.08761','MIDDLE EAST',''],
  ['PAC-B-164','MODERN KETTLE','16','6','25.00','19.00','7.50','','','','0.05838','MIDDLE EAST',''],
  ['PAC-B-165','GOLDEN ROUND KETTLE','7','24','21.75','17.75','10.00','','','','0.06326','MIDDLE EAST',''],
  ['PAC-B-166','GOLDEN ROUND KETTLE','10','24','23.50','17.00','10.00','','','','0.06547','MIDDLE EAST',''],
  ['PAC-B-167','GOLDEN ROUND KETTLE','12','24','27.00','20.00','11.75','','','','0.10398','MIDDLE EAST',''],
  ['PAC-B-168','GOLDEN ROUND KETTLE','14','18','23.50','23.50','13.50','','','','0.12217','MIDDLE EAST',''],
  ['PAC-B-169','GOLDEN ROUND KETTLE','16','18','25.00','25.00','14.50','','','','0.14851','MIDDLE EAST',''],
  ['PAC-B-170','GOLDEN ROUND KETTLE','18','12','20.50','20.50','23.75','','','','0.16356','MIDDLE EAST',''],
  ['PAC-B-171','GOLDEN ROUND KETTLE','20','6','33.00','23.00','9.75','','','','0.12127','MIDDLE EAST',''],
  ['PAC-B-172','GOLDEN ROUND KETTLE','22','6','36.00','24.00','9.75','','','','0.13804','MIDDLE EAST',''],
  ['PAC-B-173','Round Tray (Naxi design from Rect Tray)','30','12','12.50','12.50','3.50','','','6287043663674','0.00896','MIDDLE EAST',''],
  ['PAC-B-174','Round Tray (Naxi design from Rect Tray)','35','12','14.50','14.50','4.00','','','6287043663681','0.01378','MIDDLE EAST',''],
  ['PAC-B-175','Round Tray (Naxi design from Rect Tray)','40','12','17.00','17.00','4.50','','','6287043663698','0.02131','MIDDLE EAST',''],
  ['PAC-B-176','Milk Can','10','24','13.50','16.25','14.75','','','','0.05302','MIDDLE EAST',''],
  ['PAC-B-177','Kettle Plain with Netter Handle','6','48','14.25','14.25','11.00','7 ply','','','0.03660','ALSRAN',''],
  ['PAC-B-178','Kettle Plain with Netter Handle','8','48','15.50','15.50','12.50','7 ply','','','0.04921','ALSRAN',''],
  ['PAC-B-179','Kettle Plain with Netter Handle','10','24','21.50','15.00','11.00','7 ply','','','0.05813','ALSRAN',''],
  ['PAC-B-180','Kettle Plain with Netter Handle','12','24','24.50','18.50','12.75','7 ply','','','0.09470','ALSRAN',''],
  ['PAC-B-181','Kettle Plain with Netter Handle','14','24','28.50','21.50','13.50','7 ply','','','0.13556','ALSRAN',''],
  ['PAC-B-182','Kettle Plain with Netter Handle','15','24','31.50','22.50','14.50','7 ply','','','0.16841','ALSRAN',''],
  ['PAC-B-183','NEW MILK JUG BRIGHT','13','24','24.50','20.25','11.25','','','','0.09146','ALSRAN',''],
  ['PAC-B-184','NEW MILK JUG BRIGHT','15','24','23.00','20.00','18.00','','','','0.13568','ALSRAN',''],
  ['PAC-B-185','NEW MILK JUG RING TYPE','13','24','24.50','20.25','11.25','','','','0.09146','ALSRAN',''],
  ['PAC-B-186','NEW MILK JUG RING TYPE','15','24','23.00','20.00','18.00','','','','0.13568','ALSRAN',''],
  ['PAC-B-187','SCREW BARNI','16','12','22.00','14.50','18.50','','','','0.09671','ALSRAN',''],
  ['PAC-B-188','SCREW BARNI','18','12','24.50','18.00','20.00','','','','0.14453','ALSRAN',''],
  ['PAC-B-189','SCREW BARNI','20','12','27.00','20.00','22.00','','','','0.19468','ALSRAN',''],
  ['PAC-B-190','MOGLAI KATORA','8.5','48','12.00','12.00','12.00','','','','0.02832','ALSRAN',''],
  ['PAC-B-191','ZARA LONG PATTI HDL.','6(15cm/61cm)','12','35.50','7.50','7.25','','','','0.03163','ALSRAN',''],
  ['PAC-B-192','SMALL ZARA','4.5(11.5/21.5 h)','36','4.50','10.75','9.00','','','','0.00713','ALSRAN',''],
  ['PAC-B-193','SMALL ZARA','5(12.7/21.5 h)','36','5.25','11.25','9.50','','','','0.00919','ALSRAN',''],
  ['PAC-B-194','SMALL ZARA','5.5(13.9/24.2 h)','36','5.75','12.50','10.50','','','','0.01237','ALSRAN',''],
  ['PAC-B-195','STAINLESS STEEL PATTI SAUCEPAN WITH NEW HANDLE','11 (14.8x8.6)','24','_','_','_','','','','#VALUE!','ALSRAN',''],
  ['PAC-B-196','STAINLESS STEEL PATTI SAUCEPAN WITH NEW HANDLE','12 (16.2x9.3)','24','_','_','_','','','','#VALUE!','ALSRAN',''],
  ['PAC-B-197','STAINLESS STEEL PATTI SAUCEPAN WITH NEW HANDLE','14 (19x11.5)','24','_','_','_','','','','#VALUE!','ALSRAN',''],
  ['PAC-B-198','Rectangle Tray - Naxi','1','12','11.75','14.50','5.00','','','','0.01396','ALSRAN',''],
  ['PAC-B-199','Rectangle Tray - Naxi','2','12','14.50','18.75','5.25','','','','0.02339','ALSRAN',''],
  ['PAC-B-200','Rectangle Tray - Naxi','3','12','16.75','21.50','5.50','','','','0.03246','ALSRAN',''],
  ['PAC-B-201','Rectangle Tray - Plain [L-13.75 x W-11.50 x H- 1 in]','1','12','11.75','14.50','5.00','','','','0.01396','ALSRAN',''],
  ['PAC-B-202','Rectangle Tray - Plain [L-18.25 x W-14 x H- 1.25 in]','2','12','14.50','18.75','5.25','','','','0.02339','ALSRAN',''],
  ['PAC-B-203','Rectangle Tray - Plain [L-20.5 x W-15.75 x H- 1.25 in]','3','12','16.75','21.50','5.50','','','','0.03246','ALSRAN',''],
  ['PAC-B-204','Kettle (S Spout)La - Mego size 8 Portuguese design','8','24','15.25','12.25','8.50','','','','0.02602','ALSRAN',''],
  ['PAC-B-205','Kettle (S Spout)La - Mego size 9 Portuguese design','9','24','18.50','13.50','9.25','','','','0.03786','ALSRAN',''],
  ['PAC-B-206','Kettle (S Spout)La - Mego size 10 Portuguese design','10','24','21.50','15.00','11.00','','','','0.05813','ALSRAN',''],
  ['PAC-B-207','Kettle (S Spout)La - Mego size 11 Portuguese design','11','24','22.75','17.00','11.75','','','','0.07447','ALSRAN',''],
  ['PAC-B-208','Kettle (S Spout)La - Mego size 12 Portuguese design','12','24','24.50','18.50','12.50','','','','0.09284','ALSRAN',''],
  ['PAC-B-209','Kettle (S Spout)La - Mego size 13 Portuguese design','13','24','27.25','20.25','12.75','','','','0.11529','ALSRAN',''],
  ['PAC-B-210','Kettle (S Spout)La - Mego size 14 Portuguese design','14','24','28.25','21.50','13.25','','','','0.13188','ALSRAN',''],
  ['PAC-B-211','Kettle (S Spout)La - Mego size 15 Portuguese design','15','24','31.50','22.50','14.00','','','','0.16260','ALSRAN',''],
  ['PAC-B-212','Kettle (S Spout)La - Mego size 16 Portuguese design','16','24','32.00','24.00','15.00','','','','0.18878','ALSRAN',''],
  ['PAC-B-213','Kettle (S Spout)La - Mego size 17 Portuguese design','17','12','19.00','19.00','23.00','','','','0.13606','ALSRAN',''],
  ['PAC-B-214','Kettle (S Spout)La - Mego size 18 Portuguese design','18','12','19.25','19.25','23.00','','','','0.13967','ALSRAN',''],
  ['PAC-B-215','Kettle (S Spout)La - Mego size 20 Portuguese design','20','12','21.00','21.00','25.50','','','','0.18428','ALSRAN',''],
  ['PAC-B-216','Kettle (S Spout)La - Mego size 22 Portuguese design','22','12','23.00','23.00','28.50','','','','0.24706','ALSRAN',''],
  ['PAC-B-217','Modern Kettle Lisbon size 10 Portuguese design','10','24','22.50','16.50','11.00','','','','0.06692','ALSRAN',''],
  ['PAC-B-218','Modern Kettle Lisbon size 12 Portuguese design','12','12','20.50','14.50','12.00','','','','0.05845','ALSRAN',''],
  ['PAC-B-219','Modern Kettle Lisbon size 14 Portuguese design','14','12','23.00','15.50','13.00','','','','0.07595','ALSRAN',''],
  ['PAC-B-220','Modern Kettle Lisbonsize 16 Portuguese design','16','6','25.00','19.00','7.50','','','','0.05838','ALSRAN',''],
  ['PAC-B-221','Modern kettle common for box pipe type partition','12','24','12.00','3.00','5.25','','','','0.00310','ALSRAN',''],
  ['PAC-B-222','Modern kettle common for box pipe type partition','14','24','19.00','1.50','5.25','','','','0.00245','ALSRAN',''],
  ['PAC-B-223','JORDAN CASSEROLE (ss 202)','16CM','6','15.75','9.50','14.00','','','','0.03433','ALSRAN',''],
  ['PAC-B-224','JORDAN CASSEROLE (ss 202)','18CM','6','17.50','10.00','15.00','','','','0.04302','ALSRAN',''],
  ['PAC-B-225','JORDAN CASSEROLE (ss 202)','20CM','6','19.50','10.75','16.50','','','','0.05668','ALSRAN',''],
  ['PAC-B-226','JORDAN CASSEROLE (ss 202)','22CM','6','20.50','11.25','18.00','','','','0.06803','ALSRAN',''],
  ['PAC-B-227','JORDAN CASSEROLE (ss 202)','24CM','6','22.50','12.50','18.50','','','','0.08526','ALSRAN',''],
  ['PAC-B-228','JORDAN CASSEROLE (ss 202)','26CM','6','22.75','13.25','21.25','','','','0.10497','ALSRAN',''],
  ['PAC-B-229','JORDAN CASSEROLE (ss 202)','28CM','4','25.25','13.75','23.00','','','','0.13086','ALSRAN',''],
  ['PAC-B-230','JORDAN CASSEROLE (ss 202)','30CM','4','28.00','15.50','23.50','','','','0.16713','ALSRAN',''],
  ['PAC-B-231','JORDAN CASSEROLE (ss 202)','32CM','4','29.00','16.00','16.75','','','','0.12736','ALSRAN',''],
  ['PAC-B-232','JORDAN CASSEROLE (ss 202)','34CM','4','32.25','18.50','15.75','','','','0.15399','ALSRAN',''],
  ['PAC-B-233','JORDAN CASSEROLE (ss 202)','36CM','4','32.50','19.00','16.75','','','','0.16949','ALSRAN',''],
  ['PAC-B-234','JORDAN CASSEROLE (ss 202)','40CM','2','21.50','18.00','18.00','','','','0.11415','ALSRAN',''],
  ['PAC-B-235','RUSSIAN UBHA DABBA','10X14 (5PCS)','8','13.00','13.00','16.00','','','','0.04431','ALSRAN',''],
  ['PAC-B-236','SS RUSSIAN UBHA DABBA (SLIVER TOUCH)','10X14 (5PCS)','8','13.00','13.00','16.00','','','','0.04431','ALSRAN',''],
  ['PAC-B-237','JORDAN CASSEROLE (ss 202) PRINTED','16CM','1','8.75','4.50','7.50','','','','0.00484','ALSRAN',''],
  ['PAC-B-238','JORDAN CASSEROLE (ss 202) PRINTED','18CM','1','9.50','4.75','8.50','','','','0.00629','ALSRAN',''],
  ['PAC-B-239','JORDAN CASSEROLE (ss 202) PRINTED','20CM','1','10.50','5.25','9.25','','','','0.00836','ALSRAN',''],
  ['PAC-B-240','JORDAN CASSEROLE (ss 202) PRINTED','22CM','1','11.00','6.00','10.00','','','','0.01082','ALSRAN',''],
  ['PAC-B-241','JORDAN CASSEROLE (ss 202) PRINTED','24CM','1','12.00','6.00','11.00','','','','0.01298','ALSRAN',''],
  ['PAC-B-242','JORDAN CASSEROLE (ss 202) PRINTED','26CM','1','13.00','7.00','11.75','','','','0.01752','ALSRAN',''],
  ['PAC-B-243','JORDAN CASSEROLE (ss 202) PRINTED','28CM','1','13.75','7.50','12.25','','','','0.02070','ALSRAN',''],
  ['PAC-B-244','JORDAN CASSEROLE (ss 202) PRINTED','30CM','1','15.00','7.50','13.50','','','','0.02489','ALSRAN',''],
  ['PAC-B-245','JORDAN CASSEROLE (ss 202) PRINTED','32CM','1','15.50','8.25','14.00','','','','0.02934','ALSRAN',''],
  ['PAC-B-246','JORDAN CASSEROLE (ss 202) PRINTED','34CM','1','16.00','8.75','15.00','','','','0.03441','ALSRAN',''],
  ['PAC-B-247','JORDAN CASSEROLE (ss 202) PRINTED','36CM','1','16.25','9.00','16.00','','','','0.03835','ALSRAN',''],
  ['PAC-B-248','JORDAN CASSEROLE (ss 202) PRINTED','40CM','1','17.50','10.50','17.50','','','','0.05269','ALSRAN',''],
  ['PAC-B-249','BUSRAI TOPE WITH COVER','13X22 (MIDDLE EAST)','1','13.50','13.50','15.50','','','','0.04629','ALSRAN',''],
  ['PAC-B-250','CLASIC TOPE WITH LID','24X32 (10 PCS)','1','26.50','15.50','9.50','','','','0.06394','ALSRAN',''],
  ['PAC-B-251','CLASIC TOPE WITH LID','24X32 ( 10 PCS)','1','26.50','15.50','9.50','','','','0.06394','ALSRAN',''],
  ['PAC-B-252','Busrai Tope with Cover  (18 Pcs ) 14G.','12X20 (18Pcs)','1','12.00','12.00','12.50','','','','0.02950','ALSRAN',''],
  ['PAC-B-253','Busrai Tope with Cover (Naxi Design)','24x32 (10 PC SET)','1','19.00','19.00','14.75','','','','0.08726','ALSRAN',''],
  ['PAC-B-254','Busrai Tope with Cover','9X15 (14Pcs)','1','9.25','9.25','10.00','','','','0.01402','ALSRAN',''],
  ['PAC-B-255','Degda With Cover (Hammered)','10','12','13.50','13.50','13.50','','','','0.04032','ALSRAN',''],
  ['PAC-B-256','Degda With Cover (Hammered)','12','12','14.50','14.50','14.50','','','','0.04996','ALSRAN',''],
  ['PAC-B-257','Degda With Cover (Hammered)','14','12','15.50','15.50','16.50','','','','0.06496','ALSRAN',''],
  ['PAC-B-258','Degda With Cover (Hammered)','16','12','17.50','17.50','17.50','','','','0.08782','ALSRAN',''],
  ['PAC-B-259','Degda With Cover (Hammered)','18','12','20.00','20.00','19.00','','','','0.12454','ALSRAN',''],
  ['PAC-B-260','Degda With Cover (Hammered)','20','12','21.00','21.00','21.00','','','','0.15176','ALSRAN',''],
  ['PAC-B-261','Degda With Cover (Hammered)','22','12','23.50','23.50','23.50','','','','0.21267','ALSRAN',''],
  ['PAC-B-262','Degda With Cover (Hammered)','24','12','25.00','25.00','25.00','','','','0.25605','ALSRAN',''],
  ['PAC-B-263','Badna (w/o base)','11','24','21.50','17.00','16.00','','','6287043664527','0.09583','ALSRAN',''],
  ['PAC-B-264','Badna (w/o base)','13','24','24.00','18.00','18.00','','','6287043664534','0.12743','ALSRAN',''],
  ['PAC-B-265','Badna (w/o base)','15','24','25.50','18.50','18.50','','','6287043664541','0.14302','ALSRAN',''],
  ['PAC-B-266','Mug with Handle - Naxi','8','60','15.75','12.25','18.75','','','6287043664558','0.05928','ALSRAN',''],
  ['PAC-B-267','Mug with Handle - Naxi','9','60','18.50','13.75','19.25','','','6287043664565','0.08024','ALSRAN',''],
  ['PAC-B-268','Mug with Handle - Naxi','10','30','24.00','10.00','13.50','','','6287043664572','0.05309','ALSRAN',''],
  ['PAC-B-269','Dabba - Naxi (3pcs set)','6, 7 & 8','36','18.50','14.00','10.00','','','6287043664589','0.04244','ALSRAN',''],
  ['PAC-B-270','Dabba - Naxi (4pcs set)','10, 12, 14 & 16','8','18.50','18.50','11.50','','','6287043664596','0.06450','ALSRAN',''],
  ['PAC-B-271','Kadi Dabba - Naxi','6','120','17.00','15.00','18.50','','','6287043664602','0.07731','ALSRAN',''],
  ['PAC-B-272','Kadi Dabba - Naxi','7','120','17.50','17.50','22.00','','','6287043664619','0.11041','ALSRAN',''],
  ['PAC-B-273','Kadi Dabba - Naxi','8','120','19.50','19.50','24.00','','','6287043664626','0.14955','ALSRAN',''],
  ['PAC-B-274','Kadi Dabba - Naxi','10','36','23.50','18.00','13.50','','','6287043664633','0.09358','ALSRAN',''],
  ['PAC-B-275','Kadi Dabba - Naxi','12','36','28.00','21.00','14.75','','','6287043664640','0.14213','ALSRAN',''],
  ['PAC-B-276','Kadi Dabba - Naxi','14','24','32.00','24.50','11.00','','','6287043664657','0.14132','ALSRAN',''],
  ['PAC-B-277','Moglai Katora - Naxi','10','48','9.50','9.50','8.00','','','6287043664664','0.01183','ALSRAN',''],
  ['PAC-B-278','Moglai Katora - Naxi','12','48','11.25','11.25','8.00','','','6287043664671','0.01659','ALSRAN',''],
  ['PAC-B-279','Moglai Katora - Naxi','14','48','12.25','12.25','8.50','','','6287043664688','0.02090','ALSRAN',''],
  ['PAC-B-280','Moglai Katora - Naxi','16','48','14.00','14.00','9.75','','','6287043664695','0.03132','ALSRAN',''],
  ['PAC-B-281','Moglai Katora - Naxi','18','36','16.00','16.00','9.75','','','6287043664701','0.04090','ALSRAN',''],
  ['PAC-B-282','Moglai Katora - Naxi','20','36','17.25','17.25','9.75','','','6287043664718','0.04754','ALSRAN',''],
  ['PAC-B-283','Moglai Katora - Naxi','22','36','18.50','18.50','10.00','','','6287043664725','0.05608','ALSRAN',''],
  ['PAC-B-284','Moglai Katora - Naxi','24','24','20.00','20.00','8.00','','','6287043664732','0.05244','ALSRAN',''],
  ['PAC-B-285','Kettle Plain with Netter Handle','9','48','18.25','18.25','15.00','7 ply','','','0.08187','BADRI',''],
  ['PAC-B-286','Kettle Plain with Netter Handle','11','24','22.75','17.00','11.75','7 ply','','','0.07447','BADRI',''],
  ['PAC-B-287','Kettle Plain with Netter Handle','13','24','27.25','20.25','12.50','7 ply','','','0.11303','BADRI',''],
  ['PAC-B-288','SCREW BARNI','10','60','25.00','25.00','16.00','7 ply','','','0.16387','BADRI',''],
  ['PAC-B-289','SCREW BARNI','12','48','21.00','21.00','22.00','7 ply','','','0.15899','BADRI',''],
  ['PAC-B-290','SCREW BARNI','14','36','24.50','24.50','18.50','7 ply','','','0.18197','BADRI',''],
  ['PAC-B-291','SCREW BARNI','16','24','30.00','22.00','20.00','7 ply','','','0.21631','BADRI',''],
  ['PAC-B-292','KHUMASDAN WITH HDL','12X24 (7PCS SET)','1','15.00','15.00','19.00','7 ply','','','0.07005','BADRI',''],
  ['PAC-B-293','KHUMASDAN WITH HDL','15X27 (7PCS SET)','1','15.00','15.00','20.25','7 ply','','','0.07466','BADRI',''],
  ['PAC-B-294','MOGLAI KATORA (RIM POL)','9 (17.5cm)','200','29.50','15.00','21.75','','','','0.15772','BADRI',''],
  ['PAC-B-295','MOGLAI KATORA (RIM POL)','10 (18.5cm)','180','24.50','16.50','22.00','','','','0.14574','BADRI',''],
  ['PAC-B-296','MOGLAI KATORA (RIM POL)','11 (20.5cm)','140','18.00','18.00','23.50','','','','0.12477','BADRI',''],
  ['PAC-B-297','MOGLAI KATORA (RIM POL)','12 (22.0cm)','120','20.50','20.50','24.00','','','','0.16528','BADRI',''],
  ['PAC-B-298','MOGLAI KATORA (RIM POL)','13 (23.5cm)','120','21.25','21.25','21.50','','','','0.15910','BADRI',''],
  ['PAC-B-299','MOGLAI KATORA (RIM POL)','14 (25.5cm)','100','21.50','21.50','21.50','','','','0.16286','BADRI',''],
  ['PAC-B-300','MOGLAI KATORA (RIM POL)','16 (26.5cm)','80','23.00','23.00','31.00','','','','0.26873','BADRI',''],
  ['PAC-B-301','MOGLAI KATORA (RIM POL)','17 (28.0cm)','60','24.50','24.50','14.50','','','','0.14263','BADRI',''],
  ['PAC-B-302','MOGLAI KATORA (RIM POL)','18 (29.5cm)','60','25.50','25.50','25.00','','','','0.26639','BADRI',''],
  ['PAC-B-303','MOGLAI KATORA (RIM POL)','20 (32.0cm)','40','26.50','13.50','21.00','','','','0.12311','BADRI',''],
  ['PAC-B-304','MOGLAI KATORA (RIM POL)','22 (34.5cm)','40','29.00','14.75','17.75','','','','0.12442','BADRI',''],
  ['PAC-B-305','MOGLAI KATORA (RIM POL)','24 (38cm)','40','32.00','16.00','25.00','','','','0.20975','BADRI',''],
  ['PAC-B-306','MOGLAI KATORA (RIM POL)','26 (40cm)','40','35.00','17.25','18.00','','','','0.17809','BADRI',''],
  ['PAC-B-307','CLASIC TOPE COVER FITTMENT','24X32','2','14.00','14.00','0.00','','','','0.00000','BADRI',''],
  ['PAC-B-308','BASURAI TOP WITH COVER-12X18 (14 PCS SET)','12X18','1','11.00','11.00','11.50','','','','0.02280','BADRI',''],
  ['PAC-B-309','KHUMASDAN WITH HDL','12X20','1','11.00','11.00','15.50','','','','0.03073','BADRI',''],
  ['PAC-B-310','Milk Can','24','12','','','','','','','0.00000','BADRI',''],
  ['PAC-B-311','Screw Bottle','10','24','15.75','11.75','16.75','','','','0.05080','BADRI',''],
  ['PAC-B-312','Screw Bottle','12','24','18.00','13.75','18.25','','','','0.07402','BADRI',''],
  ['PAC-B-313','Screw Bottle','14','12','20.50','15.50','10.00','','','','0.05207','BADRI',''],
  ['PAC-B-314','Screw Bottle','16','12','24.00','18.50','11.75','','','','0.08549','BADRI',''],
  ['PAC-B-315','Hammered Round Tray','30cm','12','13.00','13.00','3.75','','','','0.01039','BADRI',''],
  ['PAC-B-316','Hammered Round Tray','35cm','12','14.50','14.50','4.50','','','','0.01550','BADRI',''],
  ['PAC-B-317','Hammered Round Tray','40cm','12','16.50','16.50','4.75','','','','0.02119','BADRI',''],
  ['PAC-B-318','Hammered Round Tray','45cm','12','18.50','18.50','4.00','','','','0.02243','BADRI','UPDATE'],
  ['PAC-B-319','Hammered Round Tray','50cm','12','20.25','20.25','4.00','','','','0.02688','BADRI',''],
  ['PAC-B-320','Hammered Round Tray','55cm','12','22.00','22.00','4.75','','','','0.03767','BADRI',''],
  ['PAC-B-321','Colander (Rice Strainer) with base','10','48','17.50','17.50','32.50','','','','0.16310','BADRI',''],
  ['PAC-B-322','Colander (Rice Strainer) with base','13','24','21.50','21.50','18.25','','','','0.13824','BADRI',''],
  ['PAC-B-323','Colander (Rice Strainer) with base','15','24','24.00','24.00','24.00','','','','0.22653','BADRI',''],
  ['PAC-B-324','Colander (Rice Strainer) with base','17','12','28.00','14.00','24.00','','','','0.15417','BADRI',''],
  ['PAC-B-325','Colander (Rice Strainer) with base','20','12','33.00','16.75','29.25','','','','0.26495','BADRI',''],
  ['PAC-B-326','Boya (Rice Strainer) w/o base','10','48','17.50','9.00','9.50','','','','0.02452','BADRI',''],
  ['PAC-B-327','Boya (Rice Strainer) w/o base','13','48','21.50','10.50','10.50','','','','0.03884','BADRI',''],
  ['PAC-B-328','Boya (Rice Strainer) w/o base','15','24','12.00','12.00','10.00','','','','0.02360','BADRI',''],
  ['PAC-B-329','Boya (Rice Strainer) w/o base','17','24','14.00','14.00','11.50','','','','0.03694','BADRI',''],
  ['PAC-B-330','Boya (Rice Strainer) w/o base','19','24','14.50','14.50','12.50','','','','0.04307','BADRI',''],
  ['PAC-B-331','Classic tope plate','24x32','2','14.00','14.00','0.00','','','','0.00000','BADRI',''],
  ['PAC-B-332','Mug with Handle - Naxi','10','60','20.50','16.50','20.50','','','','0.11363','BADRI',''],
  ['PAC-B-333','Canister with Lid (3 pc set)','9,10,11','1','4.95','4.95','7.90','','','','0.00317','BADRI',''],
  ['PAC-B-334','Kettle S Spout ( Naxi Design )','9','24','18.50','13.50','9.25','','','','0.03786','BADRI',''],
  ['PAC-B-335','Kettle S Spout ( Naxi Design )','10','24','21.50','15.00','11.00','','','','0.05813','BADRI',''],
  ['PAC-B-336','Kettle S Spout ( Naxi Design )','11','24','22.75','17.00','11.75','','','','0.07447','BADRI',''],
  ['PAC-B-337','Kettle S Spout ( Naxi Design )','12','24','24.50','18.50','12.50','','','','0.09284','BADRI',''],
  ['PAC-B-338','Moglai Date Bowl (Naxi) with Base and seed Bowl','10','24','18.50','13.75','7.00','','','6287043667771','0.02918','BADRI',''],
  ['PAC-B-339','Moglai Date Bowl (Naxi) with Base and seed Bowl','12','24','21.50','16.25','7.50','','','6287043667788','0.04294','BADRI',''],
  ['PAC-B-340','Canister with Lid (3 pc set)  outer box','9,10,11','24','20.50','15.50','16.50','','','','0.08592','BADRI',''],
  ['PAC-B-341','CANISTER INNER BOX (UNIVERSAL TYPE BOX)','9,10,11','1','4.92','4.92','7.87','','','','0.00313','BADRI',''],
  ['PAC-B-342','PRINTING COST','','','','','','','','','0.00000','BADRI',''],
  ['PAC-B-343','DIE COST','','','','','','','','','0.00000','BADRI',''],
  ['PAC-B-344','Moglai Date Bowl (Naxi) w/o Base and with seed Bowl','10','48','18.50','13.75','11.25','','','6287043668310','0.04690','BADRI',''],
  ['PAC-B-345','Moglai Date Bowl (Naxi) w/o Base and with seed Bowl','12','48','21.50','16.25','12.25','','','6287043668327','0.07013','BADRI',''],
  ['PAC-B-346','Busrai Tope with Handles','34,38,42','1','24.00','24.00','20.50','','','6287043668617','0.19350','BADRI',''],
  ['PAC-B-347','Busrai Tope with Handles','36,40,44','1','25.00','25.00','20.50','','','6287043668624','0.20996','BADRI',''],
  ['PAC-B-348','Camel Milk Bowl','7','60','18.50','14.00','13.25','','','OUTER BOX SIZE IN INCH','0.05624','BADRI',''],
  ['PAC-B-349','Camel Milk Bowl (Naxi Design)','7','60','18.50','14.00','13.25','','','OUTER BOX SIZE IN INCH','0.05624','BADRI',''],
  ['PAC-B-350','Camel Milk Bowl','7','','112.00','112.00','60.00','','','','12.33356','BADRI',''],
  ['PAC-B-351','Camel Milk Bowl (Naxi Design)','7','','112.00','112.00','60.00','','','','12.33356','BADRI',''],
  ['PAC-B-352','Modern Milk Jug (Alu. Casting Handle & Knob)','11','12','16.50','15.75','11.50','7 PLY','','','0.04897','BADRI',''],
  ['PAC-B-353','Modern Milk Jug (Alu. Casting Handle & Knob)','13','12','19.75','18.75','11.75','7 PLY','','','0.07130','BADRI',''],
  ['PAC-B-354','Modern Milk Jug (Alu. Casting Handle & Knob)','15','12','20.75','20.75','14.75','7 PLY','','','0.10407','BADRI',''],
  ['PAC-B-355','Kettle Plain with Netter Handle (s type spout)','22','12','23.25','23.25','28.75','7 ply','','','0.25467','BADRI',''],
  ['PAC-B-356','Kettle Plain with Netter Handle (s type spout)','5','48','','','','7 ply','','','0.00000','BADRI',''],
  ['PAC-B-357','Mug with Handle - Naxi','6','60','12.50','9.00','15.00','UPDATE','','','0.02765','BADRI',''],
  ['PAC-B-358','Mug with Handle - Naxi','7','60','14.25','10.50','17.50','','','','0.04291','BADRI',''],
  ['PAC-B-359','Mug with Handle - Naxi Tray Plate','6','12','300 mm','225 mm','','','','','#VALUE!','BADRI',''],
  ['PAC-B-360','Mug with Handle - Naxi Tray Plate','7','12','340 mm','255 mm','','','','','#VALUE!','BADRI',''],
  ['PAC-B-361','Mug with Handle - Naxi Tray Plate','8','12','385 mm','290 mm','','','','','#VALUE!','BADRI',''],
  ['PAC-B-362','Mug with Handle - Naxi Tray Plate','9','12','450 mm','340 mm','','','','','#VALUE!','BADRI',''],
  ['PAC-B-363','Came Milk Bowl Box- 350 GSM ITC Board, Print CMYK, Glass Laminantion Size of Box- 112x112x60 mm (Printing , S. Cutting, Punching)','7','1','112mm','112mm','60mm','','','','#VALUE!','BADRI',''],
  ['PAC-B-364','Die Cut  (Die Cut Punch) 112x112x60 mm','7','1','112mm','112mm','60mm','','','','#VALUE!','BADRI',''],
  ['PAC-B-365','Kettle Plain with Netter Handle (s type spout)','5','48','14.00','14.00','10.50','','','','0.03372','BADRI',''],
  ['PAC-B-366','Kettle Plain with Netter Handle (s type spout)','16','24','32.00','24.00','15.50','','','','0.19507','BADRI',''],
  ['PAC-B-367','Kettle Plain with Netter Handle','16','24','32.00','24.00','15.50','','','','0.19507','BADRI',''],
  ['PAC-B-368','Kettle Plain with Netter Handle','17','18','27.50','27.50','16.00','','','','0.19828','BADRI',''],
  ['PAC-B-369','Kettle Plain with Netter Handle','18','18','28.50','28.50','16.00','','','','0.21297','BADRI',''],
  ['PAC-B-370','Kettle Plain with Netter Handle','20','12','21.00','21.00','26.00','','','','0.18789','BADRI',''],
  ['PAC-B-371','Kettle Plain with Netter Handle','22','12','23.00','23.00','28.50','','','','0.24706','BADRI',''],
  ['PAC-B-372','Kettle Plain with Netter Handle','24','12','37.50','25.50','19.00','','','','0.29773','BADRI',''],
  ['PAC-B-373','Moglai Katora (Rim pol)','10x18','12','23.00','23.00','15.00','','','','0.13003','BADRI',''],
  ['PAC-B-374','Dabba - Naxi (3pcs set)','6, 7 & 8','36','18.50','14.00','10.00','','','','0.04244','BADRI',''],
  ['PAC-B-375','Dabba - Naxi (4pcs set)','10, 12, 14 & 16','8','18.50','18.50','11.50','','','','0.06450','BADRI',''],
  ['PAC-B-376','Degda With Cover (Hammered)','10','12','13.50','13.50','13.50','','','','0.04032','BADRI',''],
  ['PAC-B-377','Degda With Cover (Hammered)','12','12','14.50','14.50','14.50','','','','0.04996','BADRI',''],
  ['PAC-B-378','Degda With Cover (Hammered)','14','12','15.50','15.50','16.50','','','','0.06496','BADRI',''],
  ['PAC-B-379','Degda With Cover (Hammered)','16','12','17.50','17.50','17.50','','','','0.08782','BADRI',''],
  ['PAC-B-380','Degda With Cover (Hammered)','18','12','20.00','20.00','19.00','','','','0.12454','BADRI',''],
  ['PAC-B-381','Degda With Cover (Hammered)','20','12','21.00','21.00','21.00','','','','0.15176','BADRI',''],
  ['PAC-B-382','Degda With Cover (Hammered)','22','12','23.50','23.50','23.50','','','','0.21267','BADRI',''],
  ['PAC-B-383','Degda With Cover (Hammered)','24','12','25.00','25.00','25.00','','','','0.25605','BADRI',''],
  ['PAC-B-384','HMD. COOKING POT WITH LID','15x23 (5PCS)','1','25.00','13.50','9.50','','','','0.05254','BADRI',''],
  ['PAC-B-385','HMD. COOKING POT WITH LID','17x25 (5PCS)','1','27.50','14.50','10.25','','','','0.06698','BADRI',''],
  ['PAC-B-386','NAXI KADI DABBA OLD DESIGN (10x16)','10x16 (4PCS)','12','27.50','18.50','13.50','','','','0.11255','BADRI',''],
  ['PAC-B-387','Mug with Handle - Naxi','10','60','20.50','16.50','20.50','','','6287043664572','0.11363','BADRI',''],
  ['PAC-B-388','Mug with Handle - Naxi Tray Plate','10','12','500 MM','395 MM','','','','','#VALUE!','BADRI',''],
  ['PAC-B-389','Kettle Plain with Netter Handle','32','4','32.00','32.00','13.50','','','','0.22653','BADRI',''],
  ['PAC-B-390','Kettle Plain with Netter Handle And naxi cover','10','24','21.50','15.00','11.00','','','','0.05813','BADRI',''],
  ['PAC-B-391','Kettle Plain with Netter Handle And naxi cover','11','24','22.75','17.00','11.75','','','','0.07447','BADRI',''],
  ['PAC-B-392','Kettle Plain with Netter Handle And naxi cover','12','24','24.50','18.50','12.50','','','','0.09284','BADRI',''],
  ['PAC-B-393','Kettle Plain s type spout (Bright Finish)','8','48','15.50','15.50','12.50','','','','0.04921','BADRI',''],
  ['PAC-B-394','Kettle Plain s type spout (Bright Finish)','9','48','18.25','18.25','15.00','','','','0.08187','BADRI',''],
  ['PAC-B-395','Kettle Plain s type spout (Bright Finish)','10','24','21.50','15.00','11.00','','','','0.05813','BADRI',''],
  ['PAC-B-396','Kettle Plain s type spout (Bright Finish)','11','24','22.75','17.00','11.75','','','','0.07447','BADRI',''],
  ['PAC-B-397','Kettle Plain s type spout (Bright Finish)','12','24','24.50','18.50','12.50','','','','0.09284','BADRI',''],
  ['PAC-B-398','Horizontal Dabba (Naxi)','10x12 (3pc set)','12','17.25','17.25','10.75','','018-0001','','0.05242','BADRI',''],
  ['PAC-B-399','Horizontal Dabba (Naxi)','12x14 (3pc set)','12','19.75','19.75','13.00','','018-0002','','0.08310','BADRI',''],
  ['PAC-B-400','Horizontal Dabba See thru (Naxi)','10x12 (3pc set)','12','17.25','17.25','10.75','','018-0003','','0.05242','BADRI',''],
  ['PAC-B-401','Horizontal Dabba See thru (Naxi)','12x14 (3pc set)','12','19.75','19.75','13.00','','018-0004','','0.08310','BADRI',''],
  ['PAC-B-402','Glass with Naxi','4','240','11.50','5.00','9.25','','022-0214','','0.00872','BADRI',''],
  ['PAC-B-403','Glass with Naxi','5','240','14.50','6.50','11.00','','022-0215','','0.01699','BADRI',''],
  ['PAC-B-404','Glass with Naxi','6','240','18.25','7.50','11.50','','022-0216','','0.02579','BADRI',''],
  ['PAC-B-405','Glass with Naxi','7','240','20.00','9.00','12.00','','022-0217','','0.03540','BADRI',''],
  ['PAC-B-406','Glass with Naxi','8','240','24.50','10.00','12.50','','022-0218','','0.05019','BADRI',''],
  ['PAC-B-407','Ladle (bowl dia 4.25", rod 20")','6','24','20.00','20.00','7.50','','024-0222','','0.04916','BADRI',''],
  ['PAC-B-408','Ladle (bowl dia 4.75", rod 20")','7','24','23.50','18.50','8.50','','024-0223','','0.06056','BADRI',''],
  ['PAC-B-409','Ladle (bowl dia 5", rod 20")','8','24','22.75','18.25','11.00','','024-0224','','0.07484','BADRI',''],
  ['PAC-B-410','Ladle (bowl dia 6", rod 20")','9','24','23.50','18.50','11.50','','024-0225','','0.08193','BADRI',''],
  ['PAC-B-411','Zara w/Long Hdle (15cm, 61cm rod)','6','12','27.25','6.50','7.25','','024-0226','','0.02104','BADRI',''],
  ['PAC-B-412','Zara w/Long Hdle (18cm, 82cm rod)','7','12','35.50','7.50','7.25','','024-0227','','0.03163','BADRI',''],
  ['PAC-B-413','Zara w/Long Hdle (20cm, 82cm rod)','8','12','36.50','8.50','7.75','','024-0228','','0.03940','BADRI',''],
  ['PAC-B-414','Zara w/Long Hdle (23cm, 82cm rod)','9','12','37.50','9.50','7.75','','024-0229','','0.04524','BADRI',''],
  ['PAC-B-415','Zara w/Long Hdle (26cm, 82cm rod)','10','12','38.50','10.50','8.00','','024-0230','','0.05300','BADRI',''],
  ['PAC-B-416','Zara w/Long Hdle (28cm, 82cm rod)','11','12','38.50','11.50','8.00','','024-0231','','0.05804','BADRI',''],
  ['PAC-B-417','Tawa plain 6mm','35','6','14.25','15.75','3.00','','024-0236','','0.01103','BADRI',''],
  ['PAC-B-418','Tawa plain 6mm','40','6','15.75','17.75','3.00','','024-0237','','0.01374','BADRI',''],
  ['PAC-B-419','Tawa plain 6mm','45','6','17.75','19.75','3.00','','024-0238','','0.01723','BADRI',''],
  ['PAC-B-420','Tawa plain 6mm','50','6','19.75','21.75','3.00','','024-0239','','0.02112','BADRI',''],
  ['PAC-B-421','Tawa with 2 layer Non Stick Coating','35','6','14.25','15.75','3.00','','024-0232','','0.01103','BADRI',''],
  ['PAC-B-422','Tawa with 2 layer Non Stick Coating','40','6','15.75','17.75','3.00','','024-0233','','0.01374','BADRI',''],
  ['PAC-B-423','Tawa with 2 layer Non Stick Coating','45','6','17.75','19.75','3.00','','024-0234','','0.01723','BADRI',''],
  ['PAC-B-424','Tawa with 2 layer Non Stick Coating','50','6','19.75','21.75','3.00','','024-0235','','0.02112','BADRI',''],
  ['PAC-B-425','CLASSIC MILK JUG','11','24','27.00','19.00','8.00','','-','-','0.06725','BADRI',''],
  ['PAC-B-426','CLASSIC MILK JUG','13','24','33.00','22.00','9.00','','-','-','0.10707','BADRI',''],
  ['PAC-B-427','CLASSIC MILK JUG','15','24','25.00','19.00','20.00','','-','-','0.15568','BADRI',''],
  ['PAC-B-428','CLASSIC MILK JUG','17','12','','','','','','','0.00000','BADRI',''],
  ['PAC-B-429','Rect. Tray ( 4 pcs set )','2x5','1','26.50','20.50','3.50','','','','0.03116','BADRI',''],
  ['PAC-B-430','Milk Can','16','18','19.50','19.50','22.00','','','','0.13709','BADRI',''],
  ['PAC-B-431','Naxi Chilamchi','15','24','33.25','26.00','16.00','','','','0.22667','BADRI',''],
  ['PAC-B-432','Naxi Chilamchi','18','12','32.50','24.50','16.00','','','','0.20877','BADRI',''],
  ['PAC-B-433','Plain chilamchi','15','24','33.25','26.00','16.00','','','','0.22667','BADRI',''],
  ['PAC-B-434','Plain chilamchi','18','12','32.50','24.50','16.00','','','','0.20877','BADRI',''],
  ['PAC-B-435','Ubha dabba','15x18','8','17.50','17.50','20.00','','','','0.10037','BADRI',''],
  ['PAC-B-436','HMD. COOKING POT WITH LID','20x25','1','27.50','14.50','17.00','','','','0.11108','BADRI',''],
  ['PAC-B-437','MANDI B.TOP/COVER','30','1','18.00','18.00','10.50','','','','0.05575','BADRI',''],
  ['PAC-B-438','MANDI B.TOP/COVER','32','1','19.00','19.00','11.00','','','','0.06507','BADRI',''],
  ['PAC-B-439','Breakfast Tray with Lid (7 Bowls)','40 cm','6','19.00','19.00','18.00','','','','0.10648','BADRI',''],
  ['PAC-B-440','Breakfast Tray with Lid (7 Bowls)','44 cm','6','20.00','20.00','19.00','','','','0.12454','BADRI',''],
  ['PAC-B-441','Badna (with base)','13','24','25.00','19.00','19.00','','','','0.14789','BADRI',''],
  ['PAC-B-442','Badna (with base)','15','24','26.50','19.50','20.00','','','','0.16936','BADRI',''],
  ['PAC-B-443','STAILESS STEEL INDUCTION BOTTOM SAUCE PAN WITH COVER','18','24','25.00','18.00','18.00','','','','0.13274','BADRI',''],
  ['PAC-B-444','STAILESS STEEL INDUCTION BOTTOM SAUCE PAN WITH COVER','20','24','25.50','18.50','18.50','','','','0.14302','BADRI',''],
  ['PAC-B-445','SS PURI DABBA (SEE THRU)','7','20','9.50','9.50','11.75','','','','0.01738','BADRI',''],
  ['PAC-B-446','SS PURI DABBA (SEE THRU)','8','20','11.50','11.50','13.00','','','','0.02817','BADRI',''],
  ['PAC-B-447','SS PURI DABBA (SEE THRU)','9','20','12.50','12.50','14.50','','','','0.03713','BADRI',''],
  ['PAC-B-448','SS PURI DABBA (SEE THRU)','10','20','14.50','14.50','14.50','','','','0.04996','BADRI',''],
  ['PAC-B-449','SS PURI DABBA (SEE THRU)','11','20','15.50','15.50','14.50','','','','0.05709','BADRI',''],
  ['PAC-B-450','SS PURI DABBA (SEE THRU)','12','16','17.50','17.50','13.50','','','','0.06775','BADRI',''],
  ['PAC-B-451','SS PURI DABBA (SEE THRU)','13','16','17.50','17.50','15.50','','','','0.07779','BADRI',''],
  ['PAC-B-452','SS PURI DABBA (SEE THRU)','14','16','19.50','19.50','16.50','','','','0.10281','BADRI',''],
  ['PAC-B-453','S.S. SADA UBHA DABBA','15x18','8','17.50','17.50','20.00','','','','0.10037','BADRI',''],
  ['PAC-B-454','S.S SADA UBHA DABBA','7X9','30','18.00','12.00','11.25','','','','0.03982','BADRI',''],
  ['PAC-B-455','S.S SADA UBHA DABBA','10X14','8','13.00','13.00','16.00','','','','0.04431','BADRI',''],
  ['PAC-B-456','SAUCE PAN WITH COVER','9x15 (7PCS)','8','20.00','20.00','18.50','','','','0.12126','BADRI',''],
  ['PAC-B-457','MOGLAI KATORA (SADA)-6.5X8.5 (3PCS)','6.5x8.5 (3PCS)','48','19.00','14.00','13.75','','','','0.05994','BADRI',''],
  ['PAC-B-458','MILK PAN','9','24','15.50','15.50','10.00','','','','0.03937','BADRI',''],
  ['PAC-B-459','MILK PAN','11','24','17.50','17.50','11.00','','','','0.05520','BADRI',''],
  ['PAC-B-460','MILK PAN','13','24','19.00','19.00','11.00','','','','0.06507','BADRI',''],
  ['PAC-B-461','Basin','7','200','12.50','12.50','13.50','','','','0.03457','BADRI',''],
  ['PAC-B-462','Basin','8','200','14.50','14.50','14.50','','','','0.04996','BADRI',''],
  ['PAC-B-463','Basin','9','200','15.50','15.50','13.75','','','','0.05413','BADRI',''],
  ['PAC-B-464','Basin','10','200','18.50','18.50','15.00','','','','0.08413','BADRI',''],
  ['PAC-B-465','MESS TRAY','40x30','30','18.50','14.75','5.50','','','','0.02459','MV DESAI',''],
  ['PAC-B-466','BETHA DABBA','7X10','20','21.50','14.00','10.00','','','','0.04933','MV DESAI',''],
  ['PAC-B-467','SADA VATI','4/4.5/5/5.5/6.5','60','14.50','14.50','11.00','','','','0.03790','MV DESAI',''],
  ['PAC-B-468','ROYAL GLASS','7.5x10.5','72','20.50','9.25','10.50','','','','0.03263','MV DESAI',''],
  ['PAC-B-469','PURI DABBA','6X8','36','22.00','22.00','6.00','','','','0.04759','MV DESAI',''],
  ['PAC-B-470','BELLY PURI DABBA','10X12','8','17.50','17.50','8.50','','','','0.04266','MV DESAI',''],
  ['PAC-B-471','MUKTA VATI','4.5cm','300','9.75','9.75','8.50','','','','0.01324','MV DESAI',''],
  ['PAC-B-472','MUKTA VATI','5.5cm','100','9.75','9.75','8.50','','','','0.01324','MV DESAI',''],
  ['PAC-B-473','MUKTA VATI','6.5cm','100','9.75','9.75','8.50','','','','0.01324','MV DESAI',''],
  ['PAC-B-474','PATTI VATI','4.5/5.5/6','60','16.00','16.00','10.00','','','','0.04195','MV DESAI',''],
  ['PAC-B-475','PAWALI W/ COVER','12X18 (4PC)','1','15.50','15.50','17.50','','','','0.06890','MV DESAI',''],
  ['PAC-B-476','CLASSIC TEA KETTLE','10 LTR','1','13.50','13.50','15.50','','','','0.04629','MV DESAI',''],
  ['PAC-B-477','CLASSIC TEA KETTLE','15 LTR','1','13.50','13.50','17.00','','','','0.05077','MV DESAI',''],
  ['PAC-B-478','CLASSIC TEA KETTLE','20 LTR','1','14.00','14.00','17.00','','','','0.05460','MV DESAI',''],
  ['PAC-B-479','SOUTH INDIAN TRAY','27X34.5','25','14.50','11.50','5.00','','','','0.01366','MV DESAI',''],
  ['PAC-B-480','DOSA TRAY','33x28CM','50','12.50','12.50','9.00','','','','0.02304','MV DESAI',''],
  ['PAC-B-481','MASALA PETTI (KOMAL ) JUMBO','6','3','14.00','14.00','10.00','','','','0.03212','MV DESAI',''],
  ['PAC-B-482','MASALA PETTI (KOMAL ) JUMBO','9','4','18.75','13.50','14.50','','','','0.06015','MV DESAI',''],
  ['PAC-B-483','MASALA PETTI (KOMAL ) JUMBO','12','3','18.75','13.50','14.50','','','','0.06015','MV DESAI',''],
  ['PAC-B-484','New Delux Tray Round','14in','30','12.00','12.00','7.00','','','','0.01652','MV DESAI',''],
  ['PAC-B-485','New Delux Tray Round','15in','30','14.00','14.00','7.00','','','','0.02248','MV DESAI',''],
  ['PAC-B-486','Choras Wati Manchurian Tray','10.5x13in','25','11.75','14.50','5.50','','','','0.01536','MV DESAI',''],
  ['PAC-B-487','Samosa Tray Round','13.75in','30','14.00','14.00','10.00','','','','0.03212','MV DESAI',''],
  ['PAC-B-488','Rect Tray with 6 khacha','','25','18.50','14.75','5.50','','','','0.02459','MV DESAI',''],
  ['PAC-B-489','Rect Tray with 4 khacha','','30','18.50','14.75','5.50','','','','0.02459','MV DESAI',''],
  ['PAC-B-490','BOMBAY TIFFIN','14CM','24','23.00','20.00','18.00','','','','0.13568','MV DESAI',''],
  ['PAC-B-491','Betha dabba (Frosted)','8x13 (6pcs)','8','15.50','15.50','10.00','','','','0.03937','MV DESAI',''],
  ['PAC-B-492','BRASS SEV SANCHA','6 JALI','10','9.75','9.75','8.50','','','','0.01324','MV DESAI',''],
  ['PAC-B-493','CB FLAT BOTTM TOPE/COVER','9X14','4','17.50','17.50','5.75','','','','0.02886','MV DESAI',''],
  ['PAC-B-494','CB FLAT BOTTM TOPE/COVER','9X18','2','12.00','12.00','13.50','','','','0.03186','MV DESAI',''],
  ['PAC-B-495','Naxi Dabba Sada','6','120','16.75','14.75','18.00','','','','0.07288','BADRI',''],
  ['PAC-B-496','Naxi Dabba Sada','7','120','17.00','17.00','20.75','','','','0.09827','BADRI',''],
  ['PAC-B-497','Naxi Dabba Sada','8','120','19.00','19.00','22.50','','','','0.13310','BADRI',''],
  ['PAC-B-498','Naxi Dabba Sada','11','36','24.50','18.50','12.50','','','','0.09284','BADRI',''],
  ['PAC-B-499','COFFEE WARMER','150ml','12','9.50','9.50','7.00','','','','0.01035','BADRI',''],
  ['PAC-B-500','COFFEE WARMER','350ml','12','12.00','9.00','9.00','','','','0.01593','BADRI',''],
  ['PAC-B-501','COFFEE WARMER','500ml','12','13.50','11.00','10.00','','','','0.02433','BADRI',''],
  ['PAC-B-502','COFFEE WARMER','750ml','12','14.50','12.00','10.50','','','','0.02994','BADRI',''],
  ['PAC-B-503','COFFEE WARMER','1000ml','12','15.50','12.00','11.75','','','','0.03581','BADRI',''],
];

async function seedPackingItemsIfEmpty() {
  if (!USE_DB) return;
  try {
    const r = await pool.query('SELECT COUNT(*) AS c FROM packing_items');
    const cnt = Number(r.rows?.[0]?.c ?? 0);
    if (cnt > 0) return;
  } catch { return; }
  console.log('[db] seeding packing_items —', SEED_PACKING_ITEMS.length, 'rows…');
  for (const p of SEED_PACKING_ITEMS) {
    try {
      await pool.query(
        `INSERT INTO packing_items (id,item_name,size_label,pcs_per_box,length_in,width_in,height_in,ply_type,product_code,barcode,cbm_per_box,customer_group,remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        p
      );
    } catch (e) { console.error('[db] packing_items seed row failed:', p[0], e.message); }
  }
  console.log('[db] packing_items seed complete');
}

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
  for (const t of tables) {
    try { await pool.query(`ALTER TABLE ${t} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
    catch (_) {}
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
    fixCollations().catch(() => {});
    relaxEmailUnique().catch(() => {});
    seedPackingItemsIfEmpty().catch((e) => console.error('[db] packing_items seed failed:', e.message));
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
    const initial = { users: [], delegations: [], masters: [], holidays: [], fms: [], approvals: { tasks:[], transfers:[], leaves:[] }, profile: {} };
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
  const [users, delegations, masters, holidays, fmsRows, stepRows, profileRows, completionsToday] = await Promise.all([
    q('SELECT * FROM users ORDER BY id ASC'),
    q('SELECT * FROM delegations ORDER BY id ASC'),
    q('SELECT * FROM masters ORDER BY id ASC'),
    q('SELECT * FROM holidays ORDER BY date ASC'),
    q('SELECT * FROM fms ORDER BY id ASC'),
    q('SELECT * FROM fms_steps ORDER BY fms_id ASC, step_index ASC'),
    q('SELECT * FROM profile LIMIT 1'),
    q('SELECT master_id FROM checklist_completions WHERE date = CURRENT_DATE'),
  ]);
  const byFms = new Map();
  for (const s of stepRows) {
    if (!byFms.has(s.fms_id)) byFms.set(s.fms_id, []);
    byFms.get(s.fms_id)[s.step_index] = s;
  }
  const FMS_STEPS_LEN = 8;
  const fms = fmsRows.map(r => {
    const ss = byFms.get(r.id) || [];
    const dense = [];
    for (let i=0; i<FMS_STEPS_LEN; i++) dense[i] = ss[i] || { planned:null, actual:null };
    return { id:r.id, clientName:r.client_name, platforms:r.platforms||'', mobile:r.mobile||'', doer:r.doer||'', createdAt:toIso(r.created_at), steps:dense.map(s=>({planned:toIso(s.planned),actual:toIso(s.actual)})) };
  });
  const profile = profileRows[0] ? { userId:profileRows[0].user_id, notificationEmail:profileRows[0].notification_email||'' } : { userId:null, notificationEmail:'' };
  return {
    users: users.map(userOut),
    delegations: delegations.map(r => ({ id:r.id, description:r.description, doerId:r.doer_id, doer:r.doer, delegatedBy:r.delegated_by, dueDate:toDateStr(r.due_date), client:r.client||'', status:r.status, type:r.type, priority:r.priority||'Low', url:r.url||'', approval:r.approval||'No Approval', remarks:r.remarks||'', transferredBy:r.transferred_by||null, transferredFrom:r.transferred_from||null, createdAt:toIso(r.created_at), completedAt:toIso(r.completed_at) })),
    masters: masters.map(r => ({ id:r.id, task:r.task, assignedTo:r.assigned_to||'', department:r.department||'', frequency:r.frequency, startDate:toDateStr(r.start_date), endDate:toDateStr(r.end_date), remarks:r.remarks||'', createdAt:toIso(r.created_at) })),
    holidays: holidays.map(r => ({ id:r.id, date:toDateStr(r.date), name:r.name, type:r.type||'' })),
    fms, approvals:{ tasks:[], transfers:[], leaves:[] }, profile,
    completedTodayIds: completionsToday.map(r => r.master_id),
  };
}

async function readStore() { return USE_DB ? readStoreDb() : readStoreJson(); }

async function writeStoreDb(data) {
  await ensureSchema();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM fms_steps'); await c.query('DELETE FROM fms');
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
    for (const f of data.fms||[]) {
      await c.query(`INSERT INTO fms (id,client_name,platforms,mobile,doer,created_at) VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz,NOW()))`,
        [f.id,f.clientName,f.platforms||'',f.mobile||'',f.doer||'',f.createdAt||null]);
      for (let i=0; i<(f.steps||[]).length; i++) {
        const s=f.steps[i];
        await c.query(`INSERT INTO fms_steps (fms_id,step_index,planned,actual) VALUES ($1,$2,$3,$4)`, [f.id,i,s.planned||null,s.actual||null]);
      }
    }
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
  const df = doerFilter ? doerFilter.toLowerCase() : '';
  if (filter==='all'||filter==='delegation') {
    (store.delegations||[]).forEach(d => {
      if (df && (d.doer||'').toLowerCase() !== df) return;
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
    const doneToday = new Set(store.completedTodayIds || []);
    (store.masters||[]).forEach(m => {
      if (df && (m.assignedTo||'').toLowerCase() !== df) return;
      total++;
      const dateStr = m.startDate || now.toISOString();
      if (doneToday.has(m.id)) {
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

function buildPlannedSteps(startDate=new Date()) {
  return Array.from({length:8}, (_,i) => { const d=new Date(startDate); d.setDate(d.getDate()+i+1); return {planned:d.toISOString(),actual:null}; });
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

app.use(express.static(path.join(__dirname, 'public')));

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
    return res.json({ user: { ...req.session.user, picture: user.picture || null } });
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
    return res.json({ user: { ...u, picture, permissions } });
  } catch {
    return res.json({ user: u });
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
  return res.json(computeDashboard(store, 'all', doer));
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

// ── Masters (Checklist Masters) ───────────────────────────────────────────────
app.get('/api/masters', requireAuth, async (req, res) => {
  const sessUser = req.session?.user;
  const isAdmin = isAdminUser(sessUser);
  const isHOD = isHODUser(sessUser);
  const userName = (sessUser?.name || '').toLowerCase();
  const userDept = sessUser?.department || '';
  if (!USE_DB) {
    const store = await readStore();
    let rows = store.masters||[];
    if (isHOD) {
      const teamNames = new Set((store.users || []).filter(u => (u.department || '') === userDept).map(u => (u.name || '').toLowerCase()));
      rows = rows.filter(m => teamNames.has((m.assignedTo||'').toLowerCase()) || (m.assignedTo||'').toLowerCase() === userName);
    } else if (!isAdmin) {
      rows = rows.filter(m => (m.assignedTo||'').toLowerCase() === userName);
    }
    return res.json(rows);
  }
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM masters ORDER BY created_at DESC');
  let mapped = rows.map(r => ({ id:r.id, task:r.task, assignedTo:r.assigned_to||'', department:r.department||'', frequency:r.frequency, startDate:toDateStr(r.start_date), endDate:toDateStr(r.end_date), remarks:r.remarks||'', createdAt:toIso(r.created_at) }));
  if (isHOD) {
    const teamRows = await q('SELECT LOWER(name) AS n FROM users WHERE department=$1', [userDept]);
    const teamNames = new Set(teamRows.map(r => r.n));
    mapped = mapped.filter(m => teamNames.has(m.assignedTo.toLowerCase()) || m.assignedTo.toLowerCase() === userName);
  } else if (!isAdmin) {
    mapped = mapped.filter(m => m.assignedTo.toLowerCase() === userName);
  }
  return res.json(mapped);
});

app.post('/api/masters', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!body.task?.trim()) return res.status(400).json({ error:'Task required' });
    if (!USE_DB) {
      const store = await readStore();
      const masters = store.masters||[];
      const id = 'CHK' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
      masters.push({ id, task:body.task.trim(), assignedTo:body.assignedTo||'', frequency:body.frequency||'Daily', startDate:body.startDate||null, endDate:body.endDate||null, remarks:body.remarks||'', department:body.department||'', createdAt:new Date().toISOString() });
      store.masters = masters;
      await writeStore(store);
      return res.status(201).json({ success:true, id });
    }
    await ensureSchema();
    const id = 'CHK' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
    await pool.query('INSERT INTO masters (id,task,assigned_to,frequency,start_date,end_date,remarks,department,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())', [id,body.task.trim(),body.assignedTo||'',body.frequency||'Daily',body.startDate||null,body.endDate||null,body.remarks||'',body.department||'']);
    return res.status(201).json({ success:true, id });
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
      if (body.assignedTo) m.assignedTo=body.assignedTo;
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
    await pool.query('UPDATE masters SET task=COALESCE($1,task), assigned_to=COALESCE($2,assigned_to), frequency=COALESCE($3,frequency), start_date=COALESCE($4,start_date), end_date=COALESCE($5,end_date), remarks=COALESCE($6,remarks), department=COALESCE($7,department) WHERE id=$8', [body.task??null,body.assignedTo??null,body.frequency??null,body.startDate??null,body.endDate??null,body.remarks??null,body.department??null,body.id]);
    // Fire-and-forget — bulk Transfer PATCHes many checklist rows in a row; an
    // awaited SMTP call here would serialize (and could hang) the whole batch.
    if (body.assignedTo && body.assignedTo !== prevAssignee) {
      sendChecklistTransferEmail({ assignedTo: body.assignedTo, taskDesc: body.task || before[0]?.task || '', prevAssignee }).catch(() => {});
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
    // Callers (All Tasks, Dashboard) only ever use *today's* completions to know which
    // recurring checklist items are already done today — fetching the whole history here
    // used to grow unbounded forever and get slower every day. Scope to today by default;
    // an explicit ?date= is still honored for anything that needs a specific day.
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    if (!isAdminUser(req.session?.user)) {
      const { rows } = await pool.query(
        `SELECT cc.* FROM checklist_completions cc JOIN masters m ON m.id = cc.master_id WHERE LOWER(m.assigned_to) = LOWER($1) AND cc.date = $2 ORDER BY cc.completed_at DESC`,
        [req.session?.user?.name || '', date]
      );
      return res.json(rows);
    }
    const { rows } = await pool.query('SELECT * FROM checklist_completions WHERE date = $1 ORDER BY completed_at DESC', [date]);
    return res.json(rows);
  } catch (err) {
    console.error('[api/checklist-completions]', err);
    return res.status(500).json({ error: err.message });
  }
});

// Reopen a checklist task: undo today's completion so it shows as pending again.
app.delete('/api/checklist-completions', requireAuth, async (req, res) => {
  try {
    const masterId = req.query.masterId;
    if (!masterId) return res.status(400).json({ error:'masterId required' });
    if (!USE_DB) return res.json({ success:true });
    await ensureSchema();
    await pool.query('DELETE FROM checklist_completions WHERE master_id=$1 AND date=CURRENT_DATE', [masterId]);
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
  return res.json(rows.map(({ password_hash, ...u }) => u));
});

app.post('/api/users', requireAuth, async (req, res) => {
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
          store.users.push({ id, name, email, phone:row.phone||'', department:row.department||'', roles, active:true, password_hash:hash, createdAt:new Date().toISOString() });
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
        try {
          await pool.query('INSERT INTO users (id,name,email,phone,department,roles,active,password_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7,NOW())', [id,name,email,row.phone||'',row.department||'',roles.join(','),hash]);
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
    const newUser = { id, name:body.name.trim(), email:body.email.trim(), phone:body.phone||'', department:body.department||'', roles, active:true, createdAt:new Date().toISOString() };
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
    await pool.query('INSERT INTO users (id,name,email,phone,department,roles,active,password_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7,NOW())', [id,body.name.trim(),body.email.trim().toLowerCase(),body.phone||'',body.department||'',roles.join(','),hash]);
    if (body.picture) {
      try { await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT DEFAULT NULL'); } catch {}
      await pool.query('UPDATE users SET picture=$1 WHERE id=$2', [body.picture,id]);
    }
    const result = await q('SELECT * FROM users WHERE id = $1', [id]);
    syncUsers_gs().catch(()=>{});
    return res.status(201).json(result[0]);
  } catch(e) {
    console.error('POST /api/users error:', e.message);
    return res.status(500).json({ error: e.message || 'Failed to create user' });
  }
});

app.patch('/api/users', requireAuth, async (req, res) => {
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
    return res.json(result[0]);
  } catch (err) { console.error('[PATCH /api/users]',err); return res.status(500).json({ error:err.message }); }
});

app.delete('/api/users', requireAuth, async (req, res) => {
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

app.patch('/api/leaves', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const body = req.body;
    if (!body.id||!body.status) return res.status(400).json({ error:'id and status required' });
    await pool.query('UPDATE leaves SET status=$1, decided_at=NOW() WHERE id=$2', [body.status,body.id]);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── FMS ───────────────────────────────────────────────────────────────────────
app.get('/api/fms', requireAuth, async (req, res) => {
  const store = await readStore();
  return res.json(store.fms||[]);
});

app.post('/api/fms', requireAuth, async (req, res) => {
  const body = req.body;
  if (!body.clientName||!body.clientName.trim()) return res.status(400).json({ error:'Client name required' });
  const store = await readStore();
  const entry = { id:'FMS'+Date.now(), createdAt:new Date().toISOString(), clientName:body.clientName.trim(), platforms:body.platforms||'', mobile:body.mobile||'', doer:body.doer||'', steps:buildPlannedSteps(new Date()) };
  store.fms = store.fms||[];
  store.fms.push(entry);
  await writeStore(store);
  return res.status(201).json(entry);
});

// ── FMS Step ──────────────────────────────────────────────────────────────────
app.post('/api/fms/step', requireAuth, async (req, res) => {
  const { fmsId, stepIndex } = req.body;
  const store = await readStore();
  const entry = (store.fms||[]).find(f=>f.id===fmsId);
  if (!entry) return res.status(404).json({ error:'Not found' });
  if (!entry.steps[stepIndex]) return res.status(400).json({ error:'Invalid step' });
  entry.steps[stepIndex].actual = new Date().toISOString();
  await writeStore(store);
  return res.json({ success:true });
});

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

// ── Packing Items (packing box master) ────────────────────────────────────────

async function nextPackingId() {
  const rows = await q("SELECT MAX(CAST(SUBSTRING(id,7) AS UNSIGNED)) AS maxnum FROM packing_items WHERE id REGEXP '^PAC-B-[0-9]+$'");
  const lastNum = (rows.length && rows[0].maxnum) ? parseInt(rows[0].maxnum) || 0 : 0;
  return 'PAC-B-' + (lastNum + 1);
}

app.get('/api/packing-items', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const type = req.query.type;
    const base = `SELECT id, item_type AS itemType, item_name, size_label, pcs_per_box, length_in, width_in, height_in, ply_type, product_code, barcode, cbm_per_box, customer_group, remarks, created_at AS createdAt FROM packing_items`;
    const rows = type
      ? await q(base + ' WHERE item_type = $1 ORDER BY LENGTH(id) ASC, id ASC', [type])
      : await q(base + ' ORDER BY LENGTH(id) ASC, id ASC');
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.post('/api/packing-items', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    if (!b.itemName?.trim()) return res.status(400).json({ error:'itemName required' });
    const id = await nextPackingId();
    await pool.query(
      `INSERT INTO packing_items (id,item_type,item_name,size_label,pcs_per_box,length_in,width_in,height_in,ply_type,product_code,barcode,cbm_per_box,customer_group,remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, b.itemType||'ITEM_CODE', b.itemName.trim(), b.sizeLabel||'', b.pcsPerBox||'', b.lengthIn||'', b.widthIn||'', b.heightIn||'',
       b.plyType||'', b.productCode||'', b.barcode||'', b.cbmPerBox||'', b.customerGroup||'', b.remarks||'']
    );
    return res.status(201).json({ success:true, id });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.patch('/api/packing-items', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    if (!b.id) return res.status(400).json({ error:'id required' });
    await pool.query(
      `UPDATE packing_items SET item_type=COALESCE($1,item_type), item_name=COALESCE($2,item_name), size_label=COALESCE($3,size_label),
       pcs_per_box=COALESCE($4,pcs_per_box), length_in=COALESCE($5,length_in), width_in=COALESCE($6,width_in),
       height_in=COALESCE($7,height_in), ply_type=COALESCE($8,ply_type), product_code=COALESCE($9,product_code),
       barcode=COALESCE($10,barcode), cbm_per_box=COALESCE($11,cbm_per_box), customer_group=COALESCE($12,customer_group),
       remarks=COALESCE($13,remarks)
       WHERE id=$14`,
      [b.itemType??null, b.itemName??null, b.sizeLabel??null, b.pcsPerBox??null, b.lengthIn??null, b.widthIn??null, b.heightIn??null,
       b.plyType??null, b.productCode??null, b.barcode??null, b.cbmPerBox??null, b.customerGroup??null, b.remarks??null, b.id]
    );
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.delete('/api/packing-items', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error:'id required' });
    await pool.query('DELETE FROM packing_items WHERE id = $1', [id]);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

// ── Purchase Requisitions ──────────────────────────────────────────────────────

async function nextPrId() {
  const rows = await q("SELECT MAX(CAST(SUBSTRING(id,3) AS UNSIGNED)) AS maxnum FROM purchase_requisitions WHERE id REGEXP '^PR[0-9]+$'");
  const lastNum = (rows.length && rows[0].maxnum) ? parseInt(rows[0].maxnum) || 0 : 0;
  return 'PR' + (lastNum + 1).toString().padStart(4, '0');
}

const PR_TYPE_LABEL = { ITEM_CODE: 'Item Code', PACKING_STICKER: 'Packing Sticker', PACKING_BOX: 'Packing Box', ALU: 'Aluminium' };

async function sendPrApprovalEmail({ id, prType, prDate, requestedBy, vendorId, remarks, items }) {
  const mailer = getMailer();
  if (!mailer) return;
  let vendorName = '';
  if (vendorId) {
    try { const v = await q('SELECT name FROM clients WHERE id=$1', [vendorId]); vendorName = v[0]?.name || ''; } catch {}
  }
  const total = items.reduce((s, it) => s + (parseFloat(it.quantity)||0) * (parseFloat(it.estimatedRate)||0), 0);
  const rowsHtml = items.map(it => {
    const qty = parseFloat(it.quantity)||0, rate = parseFloat(it.estimatedRate)||0;
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${it.itemName||''}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;">${it.unit||'—'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${qty}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${rate.toFixed(2)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;text-align:right;">${(qty*rate).toFixed(2)}</td>
    </tr>`;
  }).join('');
  try {
    await mailer.sendMail({
      from: `"MIS LALTD" <${process.env.SMTP_USER}>`,
      to: 'sajilshah@laltd.in',
      cc: 'store@laltd.in',
      subject: `Purchase Requisition ${id} — Approval Required (${PR_TYPE_LABEL[prType]||prType})`,
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <div style="background:#C4714A;padding:20px 24px">
          <h2 style="color:#fff;margin:0;font-size:16px">Purchase Requisition ${id}</h2>
          <div style="color:#fde8dd;font-size:12.5px;margin-top:2px;">${PR_TYPE_LABEL[prType]||prType}</div>
        </div>
        <div style="padding:24px">
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;">
            <tr><td style="padding:4px 0;color:#64748b;width:130px;">Requested By</td><td style="padding:4px 0;color:#1e293b;font-weight:600;">${requestedBy||'—'}</td></tr>
            <tr><td style="padding:4px 0;color:#64748b;">Date</td><td style="padding:4px 0;color:#1e293b;">${prDate||'—'}</td></tr>
            <tr><td style="padding:4px 0;color:#64748b;">Vendor</td><td style="padding:4px 0;color:#1e293b;">${vendorName||'—'}</td></tr>
            ${remarks ? `<tr><td style="padding:4px 0;color:#64748b;">Remarks</td><td style="padding:4px 0;color:#1e293b;">${remarks}</td></tr>` : ''}
          </table>
          <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
            <thead><tr style="background:#f8fafc;">
              <th style="padding:6px 10px;text-align:left;color:#64748b;">Item</th>
              <th style="padding:6px 10px;text-align:left;color:#64748b;">Unit</th>
              <th style="padding:6px 10px;text-align:right;color:#64748b;">Qty</th>
              <th style="padding:6px 10px;text-align:right;color:#64748b;">Rate</th>
              <th style="padding:6px 10px;text-align:right;color:#64748b;">Amount</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <p style="text-align:right;font-size:13.5px;font-weight:700;color:#1e293b;margin:12px 0 0;">Estimated Total: ₹${total.toLocaleString('en-IN',{minimumFractionDigits:2})}</p>
          <p style="color:#94a3b8;font-size:12px;margin-top:20px;">Please review and approve this requisition.</p>
        </div>
      </div>`,
    });
    console.log('[email] PR approval email sent for', id);
  } catch (e) {
    console.error('[email] PR approval email failed:', e.message);
  }
}

app.get('/api/purchase-requisitions', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const requestedById = req.query.requestedById;
    const headerSql = `SELECT pr.id, pr.pr_type AS prType, pr.pr_date AS prDate, pr.requested_by AS requestedBy, pr.requested_by_id AS requestedById, pr.vendor_id AS vendorId, c.name AS vendorName, pr.status, pr.expected_date AS expectedDate, pr.remarks, pr.created_at AS createdAt FROM purchase_requisitions pr LEFT JOIN clients c ON c.id = pr.vendor_id`;
    const headers = requestedById
      ? await q(headerSql + ' WHERE pr.requested_by_id = $1 ORDER BY pr.created_at DESC', [requestedById])
      : await q(headerSql + ' ORDER BY pr.created_at DESC');
    const items = await q(`SELECT id, pr_id AS prId, packing_item_id AS packingItemId, item_name AS itemName, unit, quantity, estimated_rate AS estimatedRate, remarks FROM purchase_requisition_items ORDER BY id ASC`);
    const byPr = new Map();
    for (const it of items) {
      if (!byPr.has(it.prId)) byPr.set(it.prId, []);
      byPr.get(it.prId).push(it);
    }
    const rows = headers.map(h => ({ ...h, items: byPr.get(h.id) || [] }));
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.post('/api/purchase-requisitions', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    if (!b.prDate) return res.status(400).json({ error:'prDate required' });
    const items = Array.isArray(b.items) ? b.items.filter(it => it.itemName?.trim()) : [];
    if (!items.length) return res.status(400).json({ error:'at least one item required' });
    const id = await nextPrId();
    const user = req.session?.user;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO purchase_requisitions (id,pr_type,pr_date,requested_by,requested_by_id,vendor_id,status,remarks)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
        [id, b.prType||'ITEM_CODE', b.prDate, user?.name||'', user?.id||null, b.vendorId||null, b.remarks||'']
      );
      let idx = 0;
      for (const it of items) {
        idx++;
        await c.query(
          `INSERT INTO purchase_requisition_items (id,pr_id,packing_item_id,item_name,unit,quantity,estimated_rate,remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id+'-'+idx, id, it.packingItemId||null, it.itemName.trim(), it.unit||'', parseFloat(it.quantity)||0, parseFloat(it.estimatedRate)||0, it.remarks||'']
        );
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    sendPrApprovalEmail({ id, prType: b.prType||'ITEM_CODE', prDate: b.prDate, requestedBy: user?.name||'', vendorId: b.vendorId||null, remarks: b.remarks||'', items }).catch(() => {});
    return res.status(201).json({ success:true, id });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.patch('/api/purchase-requisitions', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    if (!b.id) return res.status(400).json({ error:'id required' });
    await pool.query(
      `UPDATE purchase_requisitions SET status=COALESCE($1,status), vendor_id=COALESCE($2,vendor_id), remarks=COALESCE($3,remarks), pr_type=COALESCE($4,pr_type), expected_date=COALESCE($5,expected_date) WHERE id=$6`,
      [b.status??null, b.vendorId??null, b.remarks??null, b.prType??null, b.expectedDate??null, b.id]
    );
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.delete('/api/purchase-requisitions', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const id = req.query.id;
    if (!id) return res.status(400).json({ error:'id required' });
    await pool.query('DELETE FROM purchase_requisition_items WHERE pr_id = $1', [id]);
    await pool.query('DELETE FROM purchase_requisitions WHERE id = $1', [id]);
    return res.json({ success:true });
  } catch (err) { return res.status(500).json({ error:err.message }); }
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

// PATCH /api/payment-entries — mark selected ids as exported
app.patch('/api/payment-entries', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { ids, batchLabel } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const label = batchLabel || ('Export ' + new Date().toLocaleDateString('en-IN'));
    for (const id of ids) {
      await pool.query(
        `UPDATE payment_entries SET status='exported', exported_at=$1, batch_label=$2 WHERE id=$3`,
        [now, label, id]
      );
    }
    return res.json({ success: true });
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
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

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
  await seedJsonFallback();
});
