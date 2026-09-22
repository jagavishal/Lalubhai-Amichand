# Retail Dashboard

The branch expense tracker under the **Retail** sidebar section. It started
as a standalone Google Apps Script web app (`Code.gs`) bound to its own
spreadsheet; it has since been rebuilt as a native page inside this ERP, the
same way HRMS was rebuilt from its own Apps Script. This file keeps the
original script's shape documented for context (the rebuild mirrors most of
it) and, further down, the fix for that script's hardcoded secrets in case
the old spreadsheet is still reachable and worth decommissioning properly
rather than just abandoning.

## Where the rebuilt version lives

| | |
|---|---|
| `retail-dashboard` route in [public/js/components/sidebar.js](../public/js/components/sidebar.js) | Sidebar entry, Retail section. |
| [public/js/pages/retail-dashboard.js](../public/js/pages/retail-dashboard.js) | Dashboard tab (KPIs, monthly chart, category/branch/payment-type breakdowns — no charting library, same flat-bars approach as `hr-reports.js`) and Expenses tab (filterable table, CSV export, "+ New Expense", "Manage Lists"). Built on the HR module's shared `window.HR` helpers (`hr-common.js`), same as `payment-tracker.js`. |
| `server.js`, search `Retail Dashboard` | `retail_expenses` table (lazy-created like `payment_tracker`), `app_config`-backed category/item/branch lists, and `/api/retail-dashboard/*` routes, gated by `requireAdminOrPage('retail-dashboard')` — Admin/HOD always, anyone else only once granted the `retail-dashboard` page in Users → Access (see [public/js/pages/users.js](../public/js/pages/users.js)). |
| `uploads/retail-expenses/<id>/` | Invoice files (PDF/JPG/PNG/WEBP, 4 MB max), git-ignored like the other upload folders. |

**Deliberately simplified versus the original script:**
- No separate "Cheque Information" sheet/matching logic — a cheque payment
  carries its cheque date/number/amount on the expense row itself.
- Month grouping comes from the expense's own date, not a second hand-picked
  "MonthYear" field.
- No monthly email/WhatsApp report automation, and no shared dashboard
  password — access is the same page-permission model every other module
  uses.
- Branch list is seeded with the two real branches — Satellite, Bopal
  (`DEFAULT_RETAIL_EXPENSE_BRANCHES` in server.js) — not the original's
  generic placeholder city names. Add more from "Manage Lists" if needed.

## The original Apps Script (for context)

A branch expense tracker (`Code.gs`) backed by one spreadsheet with three
tabs, created by `initialize()` on first run. Deployed web app (now
superseded by the page above):
`https://script.google.com/macros/s/AKfycbxj72JbM74kgjj-lRDjTGoDTFcIAVuMKwzSLnpEezJ0-6nSX_1qKM6t8nFt6lXrBJA6Lg/exec`

| Sheet | Purpose |
|---|---|
| `Config` | Key/value rows (`ConfigType`/`ConfigValue`): `CATEGORY`/`ITEM`/`BRANCH` lists, `INVOICE_FOLDER_ID`, `DEFAULT_CC`, `ACCOUNT_EMAIL`, `TIMEZONE`, `CHEQUE_UPDATE_PASSWORD`, `DASHBOARD_PASSWORD`. |
| `Expenses` | One row per expense: Timestamp, MonthYear, Date, BranchName, PersonName, ItemName, Category, Amount, PaymentType, InvoiceUrl, CreatedBy, Note, ChequeDate, ChequeNo, ChequeAmount, EmailSent, WhatsAppSent. |
| `Cheque Information` | One row per cheque logged against a Month-Year/Branch: Person Name, Cheque Date, Cheque Number, Cheque Amount, EmailSent, WhatsAppSent, Timestamp. |

Invoices upload to a Drive folder (`Expense Tracker Invoices`, id cached in
`Config.INVOICE_FOLDER_ID`). Dashboard charts (`getPaymentMethodsData`,
`getBranchComparisonData`, `getForecastData`, `getDetailedAnalysisData`) read
straight off the `Expenses` sheet — no caching layer.

Month-end reporting sends both an HTML email (`sendExpenseEmail`) and a
WhatsApp message (`sendExpenseWhatsApp`, via the third-party `waultimate.in`
send API) summarising that month's total.

## ⚠ Hardcoded secrets — fix before relying on this further

The pasted source has real credentials as literals, not in
`PropertiesService`:

- `CHEQUE_UPDATE_PASSWORD` / `DASHBOARD_PASSWORD` — written straight into the
  `Config` sheet by `initialize()`.
- The `waultimate.in` WhatsApp API `access_token` and `instance_id` are
  literals inside `sendExpenseWhatsApp`.

Anyone with Apps Script edit access (or a copy of `Code.gs`) can read them
straight out of the source. Fix: move all four into **Project Settings →
Script Properties** and read them with `PropertiesService`, never as literals.
This repo has no access to the Apps Script project itself (it's a separate
Google-hosted script, not a file here), so this can't be applied for you —
paste the patch below into `Code.gs` and follow the steps.

### Patch

Add this helper anywhere in `Code.gs`, and the one-time migration function
next to it:

```js
// Secrets live in Project Settings → Script Properties, not in code or in
// the Config sheet, so sharing Code.gs or view access to the sheet doesn't
// leak them. No hardcoded fallback — if a property is missing this throws,
// on purpose, instead of silently falling back to a leaked value.
function getSecretProperty(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error('Missing Script Property: ' + key + ' — set it in Project Settings > Script Properties.');
  return value;
}

// Run once from the Apps Script editor (select migrateSecretsToProperties in
// the function dropdown, then Run). Copies the two passwords currently
// sitting in plaintext in the Config sheet into Script Properties.
function migrateSecretsToProperties() {
  var props = PropertiesService.getScriptProperties();
  var config = getConfig();
  if (config.CHEQUE_UPDATE_PASSWORD) props.setProperty('CHEQUE_UPDATE_PASSWORD', config.CHEQUE_UPDATE_PASSWORD);
  if (config.DASHBOARD_PASSWORD)     props.setProperty('DASHBOARD_PASSWORD', config.DASHBOARD_PASSWORD);
  Logger.log('Migrated CHEQUE_UPDATE_PASSWORD and DASHBOARD_PASSWORD to Script Properties.');
  Logger.log('Now set WHATSAPP_ACCESS_TOKEN and WHATSAPP_INSTANCE_ID by hand in Project Settings > Script Properties — this function does not know their current values.');
}
```

Then replace `verifyPassword` with:

```js
function verifyPassword(password) {
  try {
    return password === getSecretProperty('CHEQUE_UPDATE_PASSWORD');
  } catch (error) {
    Logger.log('Error in verifyPassword: ' + error.message);
    return false;
  }
}
```

And in `sendExpenseWhatsApp`, replace the hardcoded `apiUrl` line with:

```js
const apiUrl = `https://waultimate.in/api/send?number=${getSecretProperty('WHATSAPP_NOTIFY_NUMBER')}&type=text&message=${encodedMessage}&instance_id=${getSecretProperty('WHATSAPP_INSTANCE_ID')}&access_token=${getSecretProperty('WHATSAPP_ACCESS_TOKEN')}`;
```

Finally, remove the two `configSheet.appendRow([...])` lines in `initialize()`
that write `CHEQUE_UPDATE_PASSWORD` and `DASHBOARD_PASSWORD` in plaintext —
new installs should set those as Script Properties directly, never in the
sheet.

### Steps

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Paste the patch above into `Code.gs` (helper + migration function; update
   `verifyPassword` and `sendExpenseWhatsApp`).
3. Run **migrateSecretsToProperties** once (function dropdown → Run). Check
   **Project Settings → Script Properties** afterward — `CHEQUE_UPDATE_PASSWORD`
   and `DASHBOARD_PASSWORD` should now be listed there.
4. In the same Script Properties screen, add `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_INSTANCE_ID`, and `WHATSAPP_NOTIFY_NUMBER` (`917738540851`) by
   hand — the current values were only ever visible as literals in the source
   pasted into this project.
5. Delete the `CHEQUE_UPDATE_PASSWORD` and `DASHBOARD_PASSWORD` rows from the
   `Config` sheet (they're now redundant, and were plaintext-readable by
   anyone with view access to the sheet, not just edit access to the script).
6. Save, then run `verifyPassword` or trigger a WhatsApp send once to confirm
   nothing broke.
7. **Rotate the WhatsApp API token afterward** — it was exposed in this chat
   session and in the script as pasted, so treat it as compromised regardless
   of this fix.

