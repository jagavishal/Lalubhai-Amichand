// One-time data migration: copies every table from the live MySQL DB into
// the new Postgres DB. Idempotent — clears each target table first, then
// re-copies, so it can be run again safely.
//
// Usage (run from project root, with both sets of env vars available):
//   node database/scripts/mysql-to-postgres.mjs
//
// MySQL source  (Railway MySQL service vars work as-is):
//   DB_HOST|MYSQLHOST, DB_PORT|MYSQLPORT, DB_USER|MYSQLUSER,
//   DB_PASSWORD|MYSQLPASSWORD, DB_NAME|MYSQLDATABASE
// Postgres target:
//   POSTGRES_URL  (or DATABASE_URL)
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const env = process.env;
const MYSQL_URL = env.MYSQL_URL || env.MYSQL_PUBLIC_URL;
let mysqlCfg;
if (MYSQL_URL) {
  const u = new URL(MYSQL_URL);
  mysqlCfg = {
    host:     u.hostname,
    port:     Number(u.port || 3306),
    user:     decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'railway',
    dateStrings: true, // keep DATE/DATETIME as strings -> no timezone drift
  };
} else {
  mysqlCfg = {
    host:     env.DB_HOST     || env.MYSQLHOST,
    port:     Number(env.DB_PORT || env.MYSQLPORT || 3306),
    user:     env.DB_USER     || env.MYSQLUSER,
    password: env.DB_PASSWORD || env.MYSQLPASSWORD,
    database: env.DB_NAME     || env.MYSQLDATABASE,
    dateStrings: true,
  };
}

if (!mysqlCfg.host)  { console.error('❌ No MySQL source (set MYSQL_URL / MYSQL_PUBLIC_URL or DB_HOST).'); process.exit(1); }
if (!(env.POSTGRES_URL || env.DATABASE_URL)) { console.error('❌ No POSTGRES_URL / DATABASE_URL.'); process.exit(1); }

// Parent-before-child order (fms_steps references fms). Clearing happens in
// reverse so foreign keys are satisfied.
const TABLES = [
  'users', 'delegations', 'masters', 'holidays', 'clients',
  'app_config', 'checklist_completions', 'leaves',
  'daily_tasks', 'profile', 'fms', 'fms_steps', 'dev_backups',
];

async function main() {
  // Import db-postgres AFTER env is loaded (it builds its pool from POSTGRES_URL on import).
  const { pool: pg, ensureSchema } = await import('../../backend/lib/db-postgres.js');

  console.log(`→ MySQL source: ${mysqlCfg.user}@${mysqlCfg.host}:${mysqlCfg.port}/${mysqlCfg.database}`);
  const my = await mysql.createConnection(mysqlCfg);

  console.log('→ Ensuring Postgres schema (parity)…');
  await ensureSchema();

  const client = await pg.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'");

    console.log('→ Clearing Postgres target tables…');
    for (const t of [...TABLES].reverse()) {
      await client.query(`DELETE FROM "${t}"`).catch((e) => console.log(`  (skip clear ${t}: ${e.message})`));
    }

    console.log('→ Copying rows MySQL → Postgres…');
    for (const t of TABLES) {
      let rows;
      try {
        [rows] = await my.query(`SELECT * FROM \`${t}\``);
      } catch (e) {
        console.log(`  • ${t.padEnd(22)} — source table missing, skipped (${e.code || e.message})`);
        continue;
      }
      if (!rows.length) { console.log(`  • ${t.padEnd(22)} — 0 rows`); continue; }

      const cols = Object.keys(rows[0]);
      const colList = cols.map((c) => `"${c}"`).join(', ');
      const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
      const text = `INSERT INTO "${t}" (${colList}) VALUES (${ph}) ON CONFLICT DO NOTHING`;

      let n = 0;
      for (const r of rows) {
        await client.query(text, cols.map((c) => r[c]));
        n++;
      }
      console.log(`  • ${t.padEnd(22)} — ${n} rows copied`);
    }

    console.log('✅ Migration complete.');
  } finally {
    client.release();
    await my.end();
    await pg.end();
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  console.error(err);
  process.exit(1);
});
