import pg from 'pg';

const g = globalThis;

if (!g.__pg_pool) {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  // Railway's private network (*.railway.internal) and localhost don't use TLS;
  // the public proxy (proxy.rlwy.net) does. Pick SSL accordingly so the app
  // works with either the internal DATABASE_URL or the public URL.
  const useSsl = !!url && !/railway\.internal|localhost|127\.0\.0\.1/.test(url);
  // Only create pool if Postgres URL is configured — no throw at module level
  g.__pg_pool = url
    ? new pg.Pool({
        connectionString: url,
        ssl: useSsl ? { rejectUnauthorized: false } : false,
        max: 5,
        idleTimeoutMillis: 30000,
      })
    : null;
  g.__pg_schema_ready = null;
}

export const pool = g.__pg_pool;

export async function q(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/* =====================================================================
   Full schema — kept at PARITY with the MySQL schema in db.js (all
   tables + columns the app uses). PG-friendly types:
     - TINYINT(1) booleans -> SMALLINT (so `= 1` / inserting 1 still works)
     - ENUM                -> VARCHAR
     - DATETIME            -> TIMESTAMPTZ
     - MEDIUMTEXT/LONGTEXT -> TEXT
   `key`/`value` (app_config) are reserved-ish, so they stay double-quoted.
   ===================================================================== */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id                  VARCHAR(16)  PRIMARY KEY,
    name                VARCHAR(255) NOT NULL,
    email               VARCHAR(255) NOT NULL UNIQUE,
    phone               VARCHAR(64)  DEFAULT '',
    department          VARCHAR(128) DEFAULT '',
    roles               VARCHAR(128) DEFAULT 'User',
    active              SMALLINT     NOT NULL DEFAULT 1,
    password_hash       VARCHAR(255) DEFAULT NULL,
    picture             TEXT         DEFAULT NULL,
    force_logout_after  TIMESTAMPTZ  DEFAULT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_name ON users (name)`,

  `CREATE TABLE IF NOT EXISTS delegations (
    id               VARCHAR(16)  PRIMARY KEY,
    description      TEXT         NOT NULL,
    doer_id          VARCHAR(16),
    doer             VARCHAR(255) NOT NULL DEFAULT '',
    delegated_by     VARCHAR(16),
    due_date         DATE,
    client           VARCHAR(255) DEFAULT '',
    status           VARCHAR(32)  NOT NULL DEFAULT 'pending',
    type             VARCHAR(32)  NOT NULL DEFAULT 'delegation',
    priority         VARCHAR(32)  DEFAULT 'Low',
    approval         VARCHAR(64)  DEFAULT 'No Approval',
    url              VARCHAR(500) DEFAULT '',
    remarks          TEXT,
    completed_at     TIMESTAMPTZ  DEFAULT NULL,
    revise_action    VARCHAR(32)  DEFAULT NULL,
    transferred_by   VARCHAR(255) DEFAULT NULL,
    transferred_from VARCHAR(255) DEFAULT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_del_doer ON delegations (doer)`,
  `CREATE INDEX IF NOT EXISTS idx_del_status ON delegations (status)`,

  `CREATE TABLE IF NOT EXISTS masters (
    id           VARCHAR(16)  PRIMARY KEY,
    task         TEXT         NOT NULL,
    assigned_to  VARCHAR(255) DEFAULT '',
    frequency    VARCHAR(32)  NOT NULL DEFAULT 'Daily',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS holidays (
    id     VARCHAR(16)  PRIMARY KEY,
    date   DATE         NOT NULL,
    name   VARCHAR(255) NOT NULL,
    type   VARCHAR(64)  DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS fms (
    id            VARCHAR(16)  PRIMARY KEY,
    client_name   VARCHAR(255) NOT NULL,
    platforms     TEXT,
    mobile        VARCHAR(64)  DEFAULT '',
    doer          VARCHAR(255) DEFAULT '',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS fms_steps (
    fms_id      VARCHAR(16) NOT NULL REFERENCES fms(id) ON DELETE CASCADE,
    step_index  INT         NOT NULL,
    planned     TIMESTAMPTZ,
    actual      TIMESTAMPTZ,
    PRIMARY KEY (fms_id, step_index)
  )`,

  `CREATE TABLE IF NOT EXISTS profile (
    user_id             VARCHAR(16)  PRIMARY KEY,
    notification_email  VARCHAR(255) DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS app_config (
    "key"   VARCHAR(64) PRIMARY KEY,
    "value" TEXT        NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS checklist_completions (
    id           VARCHAR(16)  PRIMARY KEY,
    master_id    VARCHAR(16)  NOT NULL,
    doer         VARCHAR(255) DEFAULT '',
    completed_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    date         DATE         NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cc_master ON checklist_completions (master_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cc_date   ON checklist_completions (date)`,

  `CREATE TABLE IF NOT EXISTS leaves (
    id         VARCHAR(16)  PRIMARY KEY,
    user_id    VARCHAR(16),
    user_name  VARCHAR(255) NOT NULL,
    type       VARCHAR(64)  DEFAULT 'Leave',
    from_date  DATE         NOT NULL,
    to_date    DATE         NOT NULL,
    reason     TEXT         DEFAULT NULL,
    status     VARCHAR(32)  DEFAULT 'pending',
    approver   VARCHAR(255) DEFAULT 'HOD',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ  DEFAULT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS daily_tasks (
    id          VARCHAR(16)  PRIMARY KEY,
    entry_date  DATE         NOT NULL,
    doer_id     VARCHAR(16),
    doer        VARCHAR(255) NOT NULL DEFAULT '',
    client      VARCHAR(255) DEFAULT '',
    department  VARCHAR(128) DEFAULT '',
    description TEXT         DEFAULT NULL,
    minutes     INT          DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dt_doer ON daily_tasks (doer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dt_date ON daily_tasks (entry_date)`,

  `CREATE TABLE IF NOT EXISTS clients (
    id             VARCHAR(16)  PRIMARY KEY,
    name           VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255) DEFAULT '',
    contact_number VARCHAR(64)  DEFAULT '',
    email          VARCHAR(255) DEFAULT '',
    industry       VARCHAR(128) DEFAULT '',
    status         VARCHAR(32)  DEFAULT 'active',
    notes          TEXT         DEFAULT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS dev_backups (
    id         VARCHAR(64)  PRIMARY KEY,
    label      VARCHAR(128) NOT NULL DEFAULT '',
    data       TEXT         NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ  NOT NULL
  )`,
];

// Seed data — used when first deploy hits an empty DB.
const SEED_USERS = [
  ['U001','Abhishek Jain','abhishek@e-marketing.io','9602684444','CXO','Admin'],
  ['U002','Akhilesh Vyas','vyas.akhilesh@e-marketing.io','7048462985','Business Automation','Admin,HOD'],
  ['U003','Akshita Jain','jain.akshita@e-marketing.io','7340302359','Social Media','User'],
  ['U004','Aman Bejal','bejal.aman@e-marketing.io','6376724283','Graphic Designing','User'],
  ['U005','Aman Pareek','pareek.aman@e-marketing.io','7507905684','Business Automation','Admin,User'],
  ['U006','Ankit Ladha','ladha.ankit@e-marketing.io','7737270516','Google Ads','User'],
  ['U007','Ashish Jha','seo@e-marketing.io','9024736048','SEO','User'],
  ['U008','Bhanu Sharma','sharma.bhanu@e-marketing.io','9351842255','SEO','User'],
  ['U009','Chetna Agrawal','chetna@e-marketing.io','8238999732','CXO','User'],
  ['U010','Ching Thakral','googlexecutive@e-marketing.io','9988716423','Google Ads','User'],
  ['U011','Divvy Jain','jain.divvy@e-marketing.io','8769533770','Meta Ads','User'],
  ['U012','Divya Srivastava','srivastava.divya@e-marketing.io','9001798754','Graphic Designing','User'],
  ['U013','Garvit Kedia','kedia.garvit@e-marketing.io','9782800257','Meta Ads','User'],
  ['U014','Gaurav Gupta','gupta.gaurav@e-marketing.io','9155836021','Website Design & Development','User'],
  ['U015','Harsh Daharwal','daharwal.harsh@e-marketing.io','9596896449','Business Automation','Admin,User'],
  ['U016','Kritika Saini','saini.kritika@e-marketing.io','8696482750','Google Ads','User'],
  ['U017','Kushagra Dubey','dubey.kushagra@e-marketing.io','8203058282','Meta Ads','User'],
  ['U018','Mohit Kumawat','kumawat.mohit@e-marketing.io','6290552269','Content Writing','User'],
  ['U019','Nikita Khandelwal','khandelwal.nikita@e-marketing.io','8306660792','MDO','Admin,User'],
  ['U020','Nisha Madaan','madaan.nisha@e-marketing.io','9988820092','Google Ads','User'],
  ['U021','Nupur Kothari','kothari.nupur@e-marketing.io','9314050398','Graphic Designing','User'],
  ['U022','Pradhuman Kumar','pradhuman@e-marketing.io','7973006643','Google Ads','HOD'],
  ['U023','Priya Saini','saini.priya@e-marketing.io','9652295500','SEO','User'],
  ['U024','Purvi Saini','saini.purvi@e-marketing.io','9301878061','MDO','Admin,User'],
  ['U025','Rahul Maharchandani','maharchandani.rahul@e-marketing.io','8302671330','AI','HOD'],
  ['U026','Ritu Tilokani','tilokani.ritu@e-marketing.io','9772779351','Content Writing','HOD'],
  ['U027','Sakshi Saini','sakshi.saini@e-marketing.io','9530000022','Google Ads','User'],
  ['U028','Satish Khichi','khichi.satish@e-marketing.io','9530000023','Google Ads','User'],
  ['U029','Saurav Pareek','pareek.saurav@e-marketing.io','9530000024','Social Media','User'],
  ['U030','Swati Joshi','joshi.swati@e-marketing.io','9530000025','Content Writing','User'],
  ['U031','Tushar Chauhan','chauhan.tushar@e-marketing.io','9530000026','Website Design & Development','User'],
  ['U032','Vishal Jaga','mis1@e-marketing.io','00756492939','MDO','Admin'],
];

const SEED_DELEGATIONS = [
  ['DEL001','Need to automate the Advance Qualified Leads data (Last 90 Days in the Google Sheet)','U002','Akhilesh Vyas','U001','2026-04-08',''],
  ['DEL002','Need to Connect the Google ads account to the Claude.ai','U002','Akhilesh Vyas','U001','2026-04-07',''],
  ['DEL003','Start Curiosity based ads','U029','Saurav Pareek','U001','2026-04-08',''],
  ['DEL004','Ads Video Start for GLP','U029','Saurav Pareek','U001','2026-04-11',''],
  ['DEL005','3 new shoot videos- Ads to be started including GLP','U029','Saurav Pareek','U001','2026-04-21',''],
  ['DEL006','Content for new video in which we have to write high value offer and content for summer play also...','U026','Ritu Tilokani','U001','2026-04-22','Hero Play'],
  ['DEL007','Create google form and tasks - Employee Onboarding Process','U032','Vishal Jaga','U001','2026-05-04',''],
  ['DEL008','Speed is slow','U028','Satish Khichi','U001','2026-05-05',''],
  ['DEL009','Google review widget on home page','U028','Satish Khichi','U001','2026-05-06',''],
];

const SEED_MASTERS = [
  ['CHK001','Daily Standup Meeting','All HODs','Daily'],
  ['CHK002','Weekly Client Report','Account Managers','Weekly'],
  ['CHK003','Monthly Budget Review','Pradhuman Kumar','Monthly'],
  ['CHK004','Quarterly Performance Review','All Employees','Monthly'],
];

const SEED_HOLIDAYS = [
  ['HOL001','2026-01-26','Republic Day','National'],
  ['HOL002','2026-03-14','Holi','Festival'],
  ['HOL003','2026-08-15','Independence Day','National'],
  ['HOL004','2026-10-02','Gandhi Jayanti','National'],
  ['HOL005','2026-11-08','Diwali','Festival'],
];

async function seedIfEmpty() {
  const r = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (r.rows[0].c > 0) return;

  console.log('[db] empty DB detected — seeding initial data…');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const u of SEED_USERS) {
      await c.query(
        'INSERT INTO users (id,name,email,phone,department,roles,active) VALUES ($1,$2,$3,$4,$5,$6,1) ON CONFLICT (id) DO NOTHING',
        u
      );
    }
    for (const d of SEED_DELEGATIONS) {
      await c.query(
        `INSERT INTO delegations (id,description,doer_id,doer,delegated_by,due_date,client,status,type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','delegation')
         ON CONFLICT (id) DO NOTHING`,
        d
      );
    }
    for (const m of SEED_MASTERS) {
      await c.query(
        'INSERT INTO masters (id,task,assigned_to,frequency) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
        m
      );
    }
    for (const h of SEED_HOLIDAYS) {
      await c.query(
        'INSERT INTO holidays (id,date,name,type) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
        h
      );
    }
    await c.query(
      `INSERT INTO profile (user_id,notification_email)
       VALUES ('U032','yourrealemail@gmail.com')
       ON CONFLICT (user_id) DO NOTHING`
    );
    await c.query('COMMIT');
    console.log('[db] seed complete');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export async function ensureSchema() {
  if (g.__pg_schema_ready) return g.__pg_schema_ready;
  g.__pg_schema_ready = (async () => {
    for (const stmt of SCHEMA) await pool.query(stmt);
    await seedIfEmpty();
  })();
  return g.__pg_schema_ready;
}

// helpers — Postgres returns Date objects; we want ISO strings everywhere
export function toIso(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}
export function toDateStr(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v.slice(0, 10);
  return null;
}
