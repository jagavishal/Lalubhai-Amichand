# Lallubhai Amichand — Task Manager / ERP

Single Node.js + Express server (`server.js`) serving a vanilla-JS single-page
app from `public/`. Data lives in MariaDB/MySQL. Google Sheets and Drive are used
for the document flows (PR/PO/GRN, Proforma Invoice, Order Sheet, Packing List,
FMS), Gmail SMTP for notifications.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in DB_*, SMTP_*, NEXTAUTH_SECRET, Google creds
npm run dev                  # node --watch server.js  → http://localhost:3000
```

Without any `DB_*`/`DATABASE_URL` in `.env.local` the server falls back to a
JSON file store (`database/store.json`). That mode is for local poking only;
production always runs on the database.

## Layout

```
server.js                 # all HTTP routes, schema (ensureSchema), mailers, Sheets sync
backend/
  hrms.js                 # HR module routes (employees, attendance, leave, payroll, assets)
  bulk-mail.js            # Bulk Email module (Form 16 ZIP → per-PAN mailer)
  hr-policies-seed.js
  lib/
    fmsSheet.js           # FMS (Google-Sheet-backed flows)
    pi-format.js, order-sheet-format.js, packing-list-format.js   # sheet layouts
public/
  app.html                # the SPA shell; lists every page script with a ?v=N cache-buster
  css/style.css           # design system (tokens, dark mode, components)
  css/tw.css              # GENERATED utility classes — see scripts/gen-tw-css.js
  css/login.css           # sign-in screen
  js/utils.js, ui.js, router.js, theme.js, main.js
  js/components/          # sidebar (menu + permissions), topbar
  js/pages/               # one module per screen; hr-common.js is shared by the HR pages
database/
  migration.sql           # historical schema snapshot (ensureSchema in server.js is live)
  imports/                # one-off data loads that have already been run (kept for reference)
scripts/                  # one-off tools (sheet builders, imports, gen-tw-css.js)
samples/                  # CSV templates served from /api/samples/*
docs/                     # prompts/notes that are not code
```

## Working on the frontend

- Page scripts are plain `<script>` tags in `public/app.html`; bump the `?v=N`
  of every file you change or browsers keep the cached copy for a week.
- Utility classes (`flex`, `px-4`, `text-slate-500`, `md:grid-cols-2`, …) come
  from `public/css/tw.css`, generated from what the pages actually use. If you
  add a utility class a page never used before, run `node scripts/gen-tw-css.js`
  and bump `tw.css?v=N`.
- Shared helpers: `Utils.esc`, `Utils.apiFetch`, `Utils.showConfirm`,
  `Utils.showToast`, `Utils.todayISO`, `Utils.csvCell`, department helpers; the
  HR pages use `window.HR` from `hr-common.js`.

## Database notes

- SQL in the code is written Postgres-style (`$1` placeholders, `ON CONFLICT`)
  and translated for MySQL by `pgToMysql()` in `server.js`. Hand-written SQL
  files must be MySQL dialect.
- Schema changes go into the `SCHEMA` array in `server.js` (idempotent
  `CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`); they run at boot.

See `DEPLOY.md` for how the app ships.
