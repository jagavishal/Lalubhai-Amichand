# Deploy

Production is a Hostinger Node.js app with **git auto-deploy**: pushing to
`main` redeploys it. There is no manual build step and no PM2 to restart by hand.

## What a deploy does

1. Hostinger pulls `main` and runs `npm install` (so `package.json` changes,
   like a new dependency, are picked up automatically).
2. `node server.js` starts. On boot `ensureSchema()` applies the idempotent
   `SCHEMA` statements in `server.js` against the production MariaDB, then the
   app listens on the port Hostinger provides (`PORT`).

## Environment

Set on the server in `.env.local` (never committed). Keys are documented in
`.env.example`:

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (or a `DATABASE_URL`
  starting with `mysql://`) — production is MariaDB.
- `NEXTAUTH_SECRET` — signs session cookies. Required; without it every restart
  signs all users out.
- `SMTP_USER`, `SMTP_PASS` — Gmail app password for notifications.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` (or
  `GOOGLE_PRIVATE_KEY_B64`) — Sheets/Drive access for the document flows.
- `DEVELOPER_SECRET`, `MASTER_KEY` — optional; blank disables those panels.
- `APP_ORIGIN` — public URL used in email links (defaults to the live domain).

## Checklist before pushing

- `node --check server.js` (and any page script you touched).
- Bumped `?v=N` in `public/app.html` for every changed JS/CSS file.
- If a page gained a new utility class: `node scripts/gen-tw-css.js` and bump
  `tw.css?v=N`.
- Hand-written SQL (in `database/imports/` style one-offs) is MySQL dialect.

## After a deploy

Open the app, sign in, and load the Dashboard once: that exercises the DB pool,
the session store and the schema step. Startup problems show in Hostinger's
application log (the server logs `[db] schema statement failed …` for any
statement it had to skip).
