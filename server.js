'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

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
    const poolOpts = dbUrl
      ? { uri: dbUrl, waitForConnections: true, connectionLimit: 5 }
      : { host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, waitForConnections: true, connectionLimit: 5 };
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
      const pgPool = new pg.Pool({ connectionString: pgUrl, ssl: useSsl ? { rejectUnauthorized: false } : false, max: 5, idleTimeoutMillis: 30000 });
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
  `CREATE TABLE IF NOT EXISTS users (id VARCHAR(16) PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE, phone VARCHAR(64) DEFAULT '', department VARCHAR(128) DEFAULT '', roles VARCHAR(128) DEFAULT 'User', active SMALLINT NOT NULL DEFAULT 1, password_hash VARCHAR(255) DEFAULT NULL, picture TEXT DEFAULT NULL, force_logout_after DATETIME DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_users_name ON users (name)`,
  `CREATE TABLE IF NOT EXISTS delegations (id VARCHAR(16) PRIMARY KEY, description TEXT NOT NULL, doer_id VARCHAR(16), doer VARCHAR(255) NOT NULL DEFAULT '', delegated_by VARCHAR(16), due_date DATE, client VARCHAR(255) DEFAULT '', status VARCHAR(32) NOT NULL DEFAULT 'pending', type VARCHAR(32) NOT NULL DEFAULT 'delegation', priority VARCHAR(32) DEFAULT 'Low', approval VARCHAR(64) DEFAULT 'No Approval', url VARCHAR(500) DEFAULT '', remarks TEXT, completed_at DATETIME DEFAULT NULL, revise_action VARCHAR(32) DEFAULT NULL, transferred_by VARCHAR(255) DEFAULT NULL, transferred_from VARCHAR(255) DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX idx_del_doer ON delegations (doer)`,
  `CREATE INDEX idx_del_status ON delegations (status)`,
  `CREATE TABLE IF NOT EXISTS masters (id VARCHAR(16) PRIMARY KEY, task TEXT NOT NULL, assigned_to VARCHAR(255) DEFAULT '', frequency VARCHAR(32) NOT NULL DEFAULT 'Daily', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
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
  `CREATE TABLE IF NOT EXISTS clients (id VARCHAR(16) PRIMARY KEY, name VARCHAR(255) NOT NULL, contact_person VARCHAR(255) DEFAULT '', contact_number VARCHAR(64) DEFAULT '', email VARCHAR(255) DEFAULT '', industry VARCHAR(128) DEFAULT '', status VARCHAR(32) DEFAULT 'active', notes TEXT DEFAULT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS dev_backups (id VARCHAR(64) PRIMARY KEY, label VARCHAR(128) NOT NULL DEFAULT '', data TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS user_sessions (sid VARCHAR(128) PRIMARY KEY, data TEXT NOT NULL, expires_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function seedIfEmpty() {
  const r = await pool.query('SELECT COUNT(*) AS c FROM users');
  if (Number(r.rows[0].c) > 0) return;
  const adminEmail = process.env.ADMIN_EMAIL || 'Admin@lal.com';
  const adminName  = process.env.ADMIN_NAME  || 'Admin';
  const adminPass  = process.env.ADMIN_PASSWORD || 'Admin@1234';
  const hash = await bcrypt.hash(adminPass, 10);
  await pool.query(
    'INSERT INTO users (id,name,email,roles,active,password_hash) VALUES ($1,$2,$3,$4,1,$5) ON CONFLICT (id) DO NOTHING',
    ['A001', adminName, adminEmail, 'Admin', hash]
  );
  console.log('[db] Admin user seeded:', adminEmail);
}

async function fixCollations() {
  if (!USE_DB) return;
  const tables = ['users','delegations','masters','clients','checklist_completions','daily_tasks','leaves','user_sessions'];
  for (const t of tables) {
    try { await pool.query(`ALTER TABLE ${t} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
    catch (_) {}
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
        // Ignore "already exists" for tables and indexes
        if (!code.match(/^(ER_TABLE_EXISTS_ERROR|ER_DUP_KEYNAME|42P07|42710)$/) && !e.message?.includes('already exists')) throw e;
      }
    }
    await seedIfEmpty();
    fixCollations().catch(() => {});
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
  return { id:r.id, name:r.name, email:r.email, phone:r.phone||'', department:r.department||'', roles, active:!!r.active, picture:r.picture||null, createdAt:toIso(r.created_at) };
}

async function readStoreDb() {
  await ensureSchema();
  const [users, delegations, masters, holidays, fmsRows, stepRows, profileRows] = await Promise.all([
    q('SELECT * FROM users ORDER BY id ASC'),
    q('SELECT * FROM delegations ORDER BY id ASC'),
    q('SELECT * FROM masters ORDER BY id ASC'),
    q('SELECT * FROM holidays ORDER BY date ASC'),
    q('SELECT * FROM fms ORDER BY id ASC'),
    q('SELECT * FROM fms_steps ORDER BY fms_id ASC, step_index ASC'),
    q('SELECT * FROM profile LIMIT 1'),
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
    masters: masters.map(r => ({ id:r.id, task:r.task, assignedTo:r.assigned_to||'', frequency:r.frequency, createdAt:toIso(r.created_at) })),
    holidays: holidays.map(r => ({ id:r.id, date:toDateStr(r.date), name:r.name, type:r.type||'' })),
    fms, approvals:{ tasks:[], transfers:[], leaves:[] }, profile,
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
      await c.query(`INSERT INTO masters (id,task,assigned_to,frequency,created_at) VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz,NOW()))`,
        [m.id,m.task,m.assignedTo||'',m.frequency||'Daily',m.createdAt||null]);
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
      if (d.status==='done') { completed++; }
      else {
        pending++;
        if (d.status==='revise'||d.status==='revise_requested') revised++;
        const due = new Date(d.dueDate||d.due_date); due.setHours(0,0,0,0);
        const isOverdue = due < now;
        if (due > now) upcoming++;
        items.push({ id:d.id, doerId:d.doerId, type:'Delegation', description:d.description, doer:d.doer, date:d.dueDate||d.due_date, client:d.client||'-', overdue:isOverdue, status:d.status||'pending', priority:d.priority||'Low', url:d.url||'', remarks:d.remarks||'', transferredBy:d.transferredBy||null, transferredFrom:d.transferredFrom||null, createdAt:d.createdAt||d.created_at });
      }
    });
  }
  if (filter==='all'||filter==='checklist') {
    (store.masters||[]).forEach(m => {
      if (df && (m.assignedTo||'').toLowerCase() !== df) return;
      total++; pending++;
      items.push({ id:m.id, doerId:m.doerId||null, type:'Checklist', description:m.task, doer:m.assignedTo, date:now.toISOString(), client:'-', overdue:false, status:'pending', createdAt:m.createdAt||m.created_at });
    });
  }
  return { total, completed, pending, revised, upcoming, pendingTasks:items.sort((a,b)=>new Date(b.createdAt||b.date)-new Date(a.createdAt||a.date)).slice(0,200) };
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

function checkSecret(req) {
  const secret = req.query.secret;
  return secret && secret === process.env.DEVELOPER_SECRET;
}

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    // Check app_active
    let appActive = true;
    if (USE_DB) {
      try {
        const { rows } = await pool.query(`SELECT "value" FROM app_config WHERE "key" = 'app_active'`);
        if (rows.length > 0) appActive = rows[0].value !== 'false';
      } catch { appActive = true; }
    }
    if (!appActive) return res.status(403).json({ error: 'App is currently disabled' });

    let user = null;
    if (USE_DB) {
      try {
        await ensureSchema();
        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND active = 1', [email]);
        user = rows[0] || null;
      } catch (err) {
        console.error('[auth] Postgres error:', err.message);
      }
    }
    if (!user) {
      try {
        // Auto-seed admin on first login attempt if store is empty
        await seedJsonFallback();
        const store = await readStore();
        user = (store.users || []).find(u => u.email === email && u.active !== false) || null;
      } catch (err) {
        console.error('[auth] store error:', err.message);
      }
    }
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

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
  // fetch picture separately (not stored in cookie to keep session small)
  try {
    let picture = null;
    if (USE_DB) {
      const rows = await q('SELECT picture FROM users WHERE id = $1', [u.id]);
      picture = rows[0]?.picture || null;
    } else {
      const store = await readStoreJson();
      picture = (store.users || []).find(x => x.id === u.id)?.picture || null;
    }
    return res.json({ user: { ...u, picture } });
  } catch {
    return res.json({ user: u });
  }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', requireAuth, async (req, res) => {
  const store = await readStore();
  const doer = req.query.doer || '';
  return res.json(computeDashboard(store, 'all', doer));
});

// ── Delegations ───────────────────────────────────────────────────────────────
app.get('/api/delegations', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const { filter, myRevise } = req.query;
    const userId = req.session?.user?.id;
    const userName = req.session?.user?.name || '';

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
      return res.json(rows);
    }

    let sqlWhere = '';
    const params = [];
    if (filter === 'revise_requested') { sqlWhere = `WHERE status='revise_requested'`; }
    else if (filter === 'approval_required') { sqlWhere = `WHERE approval='Approval Required' AND status='pending'`; }
    else if (myRevise === 'true') {
      sqlWhere = `WHERE (doer_id=$1 OR doer=$2) AND status='revise'`;
      params.push(userId, userName);
    }

    const rows = await q(`SELECT id, description, doer_id AS "doerId", doer, delegated_by AS "delegatedBy", due_date AS "dueDate", client, status, type, priority, approval, url, remarks, transferred_by AS "transferredBy", transferred_from AS "transferredFrom", created_at AS "createdAt", completed_at AS "completedAt" FROM delegations ${sqlWhere} ORDER BY created_at DESC`, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

async function nextDelId() {
  const c = await q('SELECT COUNT(*) AS cnt FROM delegations');
  return 'DEL' + (Number(c[0].cnt)+1).toString().padStart(3,'0');
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
      const id = 'DEL'+String(delegations.length+1).padStart(3,'0');
      const newDel = { id, description:body.description, doerId:body.doerId, doer:doerName, delegatedBy:body.delegatedBy, dueDate:normDate(body.dueDate)||body.dueDate, client:body.client||'', status:'pending', type:'delegation', priority:body.priority||'Low', approval:resolvedApproval, url:body.url||'', remarks:body.remarks||'', createdAt:new Date().toISOString() };
      delegations.push(newDel);
      store.delegations = delegations;
      await writeStore(store);
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
    const row = await insertDelegation({ description:body.description, doerId:body.doerId, doerName:users[0]?.name, delegatedBy:body.delegatedBy, dueDate:normDate(body.dueDate)||body.dueDate, client:body.client, priority:body.priority, approval:resolvedApproval, url:body.url, remarks:body.remarks });
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
      if (newStatus==='revise') {
        if (body._grantRevise) { del.reviseAction='granted'; }
        else { newStatus='revise_requested'; del.reviseAction='pending'; }
      } else if (newStatus==='pending'&&body._denyRevise) { del.reviseAction='denied'; }
      if (newStatus) del.status=newStatus;
      if (body.dueDate) del.dueDate=body.dueDate;
      if (body.remarks!==undefined) del.remarks=body.remarks;
      if (body.approval!==undefined) del.approval=body.approval;
      if (newStatus==='done') del.completedAt=new Date().toISOString();
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
    let status = body.status;
    let reviseAction = null;
    if (status==='revise') {
      if (body._grantRevise) { reviseAction='granted'; }
      else { status='revise_requested'; reviseAction='pending'; }
    } else if (status==='pending'&&body._denyRevise) { reviseAction='denied'; }

    const completedAt = status === 'done' ? new Date() : null;
    await pool.query(
      `UPDATE delegations SET status=COALESCE($1,status), description=COALESCE($2,description), due_date=COALESCE($3,due_date), client=COALESCE($4,client), priority=COALESCE($5,priority), approval=COALESCE($6,approval), url=COALESCE($7,url), remarks=COALESCE($8,remarks), revise_action=COALESCE($9,revise_action), completed_at=COALESCE($10,completed_at) WHERE id=$11`,
      [status??null, body.description??null, body.dueDate??null, body.client??null, body.priority??null, body.approval??null, body.url??null, body.remarks??null, reviseAction, completedAt, body.id]
    );
    const result = await q('SELECT * FROM delegations WHERE id = $1', [body.id]);
    if (!result.length) return res.status(404).json({ error:'Not found' });
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

// ── Masters (Checklist Masters) ───────────────────────────────────────────────
app.get('/api/masters', requireAuth, async (req, res) => {
  if (!USE_DB) {
    const store = await readStore();
    return res.json(store.masters||[]);
  }
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM masters ORDER BY created_at DESC');
  return res.json(rows);
});

app.post('/api/masters', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    if (!body.task?.trim()) return res.status(400).json({ error:'Task required' });
    if (!USE_DB) {
      const store = await readStore();
      const masters = store.masters||[];
      const id = 'CHK'+(masters.length+1).toString().padStart(3,'0');
      masters.push({ id, task:body.task.trim(), assignedTo:body.assignedTo||'', frequency:body.frequency||'Daily', createdAt:new Date().toISOString() });
      store.masters = masters;
      await writeStore(store);
      return res.status(201).json({ success:true, id });
    }
    await ensureSchema();
    const { rows:c } = await pool.query('SELECT COUNT(*) AS cnt FROM masters');
    const id = 'CHK'+(Number(c[0].cnt)+1).toString().padStart(3,'0');
    await pool.query('INSERT INTO masters (id,task,assigned_to,frequency,created_at) VALUES ($1,$2,$3,$4,NOW())', [id,body.task.trim(),body.assignedTo||'',body.frequency||'Daily']);
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
      await writeStore(store);
      return res.json({ success:true });
    }
    await ensureSchema();
    await pool.query('UPDATE masters SET task=COALESCE($1,task), assigned_to=COALESCE($2,assigned_to), frequency=COALESCE($3,frequency) WHERE id=$4', [body.task??null,body.assignedTo??null,body.frequency??null,body.id]);
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
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM checklist_completions ORDER BY completed_at DESC');
  return res.json(rows);
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
    return res.json(store.users||[]);
  }
  await ensureSchema();
  const rows = await q('SELECT * FROM users ORDER BY id');
  return res.json(rows);
});

app.post('/api/users', requireAuth, async (req, res) => {
  const body = req.body;
  if (Array.isArray(body.bulk)) {
    await ensureSchema();
    let inserted=0; const errors=[];
    for (const [i,row] of body.bulk.entries()) {
      const name=(row.name||'').trim(); const email=(row.email||'').trim().toLowerCase();
      if (!name||!email) { errors.push(`Row ${i+1}: name/email missing`); continue; }
      const ex = await q('SELECT id FROM users WHERE email = $1', [email]);
      if (ex.length) { errors.push(`Row ${i+1}: ${email} already exists`); continue; }
      const last = await q('SELECT id FROM users ORDER BY id DESC LIMIT 1');
      const lastNum = last.length ? parseInt((last[0].id||'U000').replace('U',''))||0 : 0;
      const id = 'U'+(lastNum+1).toString().padStart(3,'0');
      const roles = parseRoles(row.role||'', row.user_role||'');
      const hash = row.password ? await bcrypt.hash(row.password, 10) : null;
      await pool.query('INSERT INTO users (id,name,email,phone,department,roles,active,password_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,1,$7,NOW())', [id,name,email,row.phone||'',row.department||'',roles.join(','),hash]);
      inserted++;
    }
    syncUsers_gs().catch(()=>{});
    return res.status(201).json({ success:true, inserted, errors });
  }

  if (!body.name||!body.email) return res.status(400).json({ error:'Name and email required' });

  if (!USE_DB) {
    const store = await readStore();
    const users = store.users||[];
    if (users.find(u=>u.email===body.email)) return res.status(400).json({ error:'Email already exists' });
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
    const ex = await q('SELECT id FROM users WHERE email = $1', [body.email.trim().toLowerCase()]);
    if (ex.length) return res.status(400).json({ error: 'Email already exists' });
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
    const rows = await q(`SELECT id, name, contact_person AS contactPerson, contact_number AS contactNumber, email, industry, status, notes, created_at AS createdAt FROM clients ORDER BY created_at DESC`);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.post('/api/clients', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    if (!b.name?.trim()) return res.status(400).json({ error:'name required' });
    const c = await q('SELECT COUNT(*) AS cnt FROM clients');
    const id = 'CL'+(Number(c[0].cnt)+1).toString().padStart(4,'0');
    await pool.query('INSERT INTO clients (id,name,contact_person,contact_number,email,industry,status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id,b.name.trim(),b.contactPerson||'',b.contactNumber||'',b.email||'',b.industry||'',b.status||'active',b.notes||'']);
    return res.status(201).json({ success:true, id });
  } catch (err) { return res.status(500).json({ error:err.message }); }
});

app.patch('/api/clients', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body;
    if (!b.id) return res.status(400).json({ error:'id required' });
    await pool.query(`UPDATE clients SET name=COALESCE($1,name), contact_person=COALESCE($2,contact_person), contact_number=COALESCE($3,contact_number), email=COALESCE($4,email), industry=COALESCE($5,industry), status=COALESCE($6,status), notes=COALESCE($7,notes) WHERE id=$8`, [b.name??null,b.contactPerson??null,b.contactNumber??null,b.email??null,b.industry??null,b.status??null,b.notes??null,b.id]);
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
        await pool.query(`INSERT INTO masters (id,task,assigned_to,frequency,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET task=EXCLUDED.task`, [m.id,m.task||'',m.assigned_to||'',m.frequency||'Daily',m.created_at||new Date()]).catch(()=>{});
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
