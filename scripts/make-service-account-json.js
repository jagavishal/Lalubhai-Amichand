'use strict';
/* Rebuilds a Google service-account key file (the JSON the Cloud Console
   downloads) from the credentials already in .env.local, so the same account
   can be configured elsewhere without generating a new key.

   Reads GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY_B64 (or
   GOOGLE_PRIVATE_KEY). If the B64 value already holds the whole key file —
   which is how it was pasted on the server once — that file is written back
   as is. Otherwise the JSON is assembled from the email and the PEM key: that
   is everything Google's client libraries need to sign in (client_email +
   private_key + token_uri); private_key_id and client_id are unknown here and
   left blank, which the libraries accept.

   Usage:  node scripts/make-service-account-json.js [output path]
   Default output: the Desktop, as <account-name>.json. Nothing is printed
   except the path and the field names — the key never goes to the terminal. */
const fs = require('fs');
const path = require('path');
const os = require('os');

const envPath = path.join(__dirname, '..', '.env.local');
const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
const get = (k) => {
  const l = lines.find((x) => x.startsWith(k + '='));
  return l ? l.slice(k.length + 1).trim().replace(/^"|"$/g, '') : '';
};

const email = get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
if (!email) { console.error('GOOGLE_SERVICE_ACCOUNT_EMAIL is not set in .env.local'); process.exit(1); }
const project = email.split('@')[1].split('.')[0];

let key = null;
const b64 = get('GOOGLE_PRIVATE_KEY_B64');
if (b64) {
  const dec = Buffer.from(b64, 'base64').toString('utf8').trim();
  if (dec.startsWith('{')) { try { key = JSON.parse(dec); } catch { /* fall through */ } }
  else if (dec.includes('BEGIN PRIVATE KEY')) key = { private_key: dec };
}
if (!key) {
  const pem = get('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  if (pem.includes('BEGIN PRIVATE KEY')) key = { private_key: pem };
}
if (!key || !key.private_key) { console.error('No private key found in .env.local (GOOGLE_PRIVATE_KEY_B64 / GOOGLE_PRIVATE_KEY)'); process.exit(1); }

const out = {
  type: 'service_account',
  project_id: key.project_id || project,
  private_key_id: key.private_key_id || '',
  private_key: key.private_key,
  client_email: key.client_email || email,
  client_id: key.client_id || '',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: key.client_x509_cert_url || `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(email)}`,
  universe_domain: 'googleapis.com',
};

const dest = process.argv[2] || path.join(os.homedir(), 'Desktop', email.split('@')[0] + '.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n', { mode: 0o600 });
console.log('Written:', dest);
console.log('Fields:', Object.keys(out).join(', '));
console.log('private_key_id / client_id', out.private_key_id ? 'present' : 'blank (fine for sign-in)');
