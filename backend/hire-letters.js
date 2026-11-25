'use strict';
/* =====================================================================
   Offer / Appointment letters for the Hiring FMS, filled into the HR's
   own Word formats (25 Nov 2026: "yha 2 format hai usse appointment and
   offer letter bnaane chahiye automatic").

   backend/templates/hire-offer-letter.docx        ("AHD Draft Offer Letter")
   backend/templates/hire-appointment-letter.docx  ("Draft Appointment Letter")

   The templates keep their own fonts, letterhead space and layout. Each
   line that carries a blank is found by its text and rewritten in the
   line's own font; the salary table gets its amounts. Everything else in
   the letter is left exactly as HR wrote it.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const TEMPLATES = {
  offer: path.join(__dirname, 'templates', 'hire-offer-letter.docx'),
  appointment: path.join(__dirname, 'templates', 'hire-appointment-letter.docx'),
};

const DEFAULT_HOURS = '9:30 am to 6:00 pm, Monday to Friday and 1st, 3rd and 5th Saturday of the month';

/* ── Small helpers ─────────────────────────────────────────────────── */

const xmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const xmlUnesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (d) => (d % 100 >= 11 && d % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][d % 10] || 'th');
// "2026-09-01" → "1st September, 2026"
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = Number(m[3]);
  return `${d}${ordinal(d)} ${MONTHS[Number(m[2]) - 1]}, ${m[1]}`;
}
// "2026-09-01" → "01/09/2026"
const shortDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ''); };
const num = (v) => { const n = Number(String(v ?? '').replace(/[,₹\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// 35500 → "Thirty Five Thousand Five Hundred"
function inWords(n) {
  n = Math.round(Number(n) || 0);
  if (!n) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
    'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ' ' + a[x % 10] : ''}`);
  const three = (x) => [x >= 100 ? `${a[Math.floor(x / 100)]} Hundred` : '', two(x % 100)].filter(Boolean).join(' ');
  const parts = [];
  const cr = Math.floor(n / 10000000); n %= 10000000;
  const lk = Math.floor(n / 100000); n %= 100000;
  const th = Math.floor(n / 1000); n %= 1000;
  if (cr) parts.push(`${three(cr)} Crore`);
  if (lk) parts.push(`${two(lk)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(' ');
}
const article = (word) => (/^[aeiou]/i.test(String(word || '').trim()) ? 'an' : 'a');

/* ── Word XML: rewrite a paragraph in its own font ──────────────────── */

const PARA_RE = /<w:p[ >][\s\S]*?<\/w:p>/g;
const textOf = (p) => xmlUnesc([...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''));

// The first run's formatting without bold — every new run starts from it.
function baseRunProps(p) {
  const r = /<w:r[ >][\s\S]*?<\/w:r>/.exec(p);
  const m = r && /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r[0]);
  return (m ? m[1] : '').replace(/<w:b\/>|<w:bCs\/>|<w:b w:val="[^"]*"\/>|<w:bCs w:val="[^"]*"\/>/g, '');
}
// Bold goes after rStyle / rFonts (Word wants the schema order inside rPr).
function withBold(props) {
  const m = /^((?:<w:rStyle[^>]*\/>)?(?:<w:rFonts[^>]*\/>)?)/.exec(props);
  const head = m ? m[1] : '';
  return head + '<w:b/><w:bCs/>' + props.slice(head.length);
}
function runs(props, segs) {
  return segs.map(([text, bold]) => {
    const rp = bold ? withBold(props) : props;
    const lines = String(text ?? '').split('\n');
    return `<w:r>${rp ? `<w:rPr>${rp}</w:rPr>` : ''}${lines.map((l, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEsc(l)}</w:t>`).join('')}</w:r>`;
  }).join('');
}
// segs = [[text, bold], …]; `nth` picks the n-th paragraph that matches.
function setPara(xml, test, segs, { nth = 0, left = false } = {}) {
  let seen = 0, done = false;
  const out = xml.replace(PARA_RE, (p) => {
    if (done || !test.test(textOf(p).trim())) return p;
    if (seen++ < nth) return p;
    done = true;
    const open = /^<w:p[ >][^>]*>|^<w:p>/.exec(p)[0];
    let pPr = (/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p) || [''])[0];
    // A justified line that breaks (an address) spreads its words apart.
    if (left) pPr = pPr.replace(/<w:jc w:val="(?:both|distribute)"\/>/, '<w:jc w:val="left"/>');
    return `${open}${pPr}${runs(baseRunProps(p), segs)}</w:p>`;
  });
  if (!done) throw new Error(`The letter format has changed — could not find the line “${test.source}”`);
  return out;
}
// Table row whose first cell reads `label`: write `value` into its second cell.
function setCell(xml, label, value) {
  const rows = xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || [];
  for (const row of rows) {
    const cells = row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    if (cells.length < 2 || textOf(cells[0]).trim().toLowerCase() !== label.toLowerCase()) continue;
    const cell = cells[1];
    const p = (cell.match(PARA_RE) || [])[0];
    if (!p) continue;
    const pPr = (/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p) || [''])[0];
    const props = (/<w:pPr>[\s\S]*?<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(p) || [, ''])[1] || baseRunProps(cells[0]);
    const open = /^<w:p[ >][^>]*>|^<w:p>/.exec(p)[0];
    const newCell = cell.replace(p, `${open}${pPr}${runs(props, [[value, false]])}</w:p>`);
    return xml.replace(row, row.replace(cell, newCell));
  }
  throw new Error(`The letter format has changed — no “${label}” row in the salary table`);
}

/* ── The two letters ─────────────────────────────────────────────────── */

function clean(f) {
  const s = (k, max = 300) => String(f?.[k] ?? '').trim().slice(0, max);
  const parts = { basic: num(f?.basic), hra: num(f?.hra), conveyance: num(f?.conveyance), medical: num(f?.medical), telephone: num(f?.telephone) };
  const gross = Object.values(parts).reduce((a, x) => a + x, 0);
  return {
    date: s('date', 10), name: s('name'), address: s('address', 600), salutation: s('salutation') || s('name'),
    position: s('position'), department: s('department'), manager: s('manager'), location: s('location'),
    start: s('start', 10), hours: s('hours', 300) || DEFAULT_HOURS, ref: s('ref', 64), focus: s('focus', 300),
    salary: num(f?.salary) || gross, probation: Math.max(0, Math.round(num(f?.probation))) || 3,
    pf: !!f?.pf, ...parts, gross,
  };
}

function need(f, keys) {
  const label = { name: 'Name', position: 'Position', start: 'Joining date', date: 'Letter date' };
  for (const k of keys) if (!f[k]) throw Object.assign(new Error(`Fill in the ${label[k] || k}`), { userError: true });
}

function offerXml(xml, f) {
  need(f, ['date', 'name', 'position']);
  xml = setPara(xml, /^Date\s*:/, [['Date : ', true], [shortDate(f.date), false]]);
  xml = setPara(xml, /^Name\s*:/, [['Name: ', true], [f.name, false]]);
  xml = setPara(xml, /^Add\s*:/, [['Add: ', true], [f.address, false]], { left: true });
  xml = setPara(xml, /^Dear\b/, [[`Dear ${f.salutation},`, false]]);
  xml = setPara(xml, /^We are pleased to offer you the/, [['We are pleased to offer you the ', false], [`${f.position} `, true],
    ['position at Lallubhai Amichand Ltd. We believe your skills, experience and passion make you an excellent fit for our team.', false]]);
  xml = setPara(xml, /^1\.\s*Job Title/, [['1. Job Title: ', false], [f.position, true]]);
  xml = setPara(xml, /^2\.\s*Department/, [['2. Department: ', false], [f.department, true]]);
  xml = setPara(xml, /^3\.\s*Reporting Manager/, [['3. Reporting Manager: ', false], [f.manager, true]]);
  xml = setPara(xml, /^4\.\s*Start Date/, [['4. Start Date: ', false], [f.start ? longDate(f.start) : '', true]]);
  xml = setPara(xml, /^5\.\s*Salary/, [['5. Salary: Per Month ', false], [f.salary ? `Rs. ${inr(f.salary)}/- (Rupees ${inWords(f.salary)} only)` : '', true]]);
  xml = setPara(xml, /^6\.\s*Work Hours/, [['6. Work Hours: ', false], [f.hours, true]]);
  xml = setPara(xml, /^7\.\s*Location/, [['7. Location: ', false], [f.location, true]]);
  xml = setPara(xml, /^I\s.*accept the offer/, [['I ', false], [f.name, true], [', accept the offer outlined above.', false]]);
  return xml;
}

function appointmentXml(xml, f) {
  need(f, ['date', 'name', 'position', 'start']);
  const start = longDate(f.start);
  xml = setPara(xml, /^Ref No\./, [[`Ref No. LA/PRS/${f.ref}`, false]]);
  xml = setPara(xml, /^Date\s*:/, [[`Date: ${shortDate(f.date)}`, false]]);
  xml = setPara(xml, /^Name\s*:/, [['Name: ', true], [f.name, false]]);
  xml = setPara(xml, /^ADD\s*:/i, [['ADD: ', true], [f.address, false]], { left: true });
  xml = setPara(xml, /^Dear\b/, [[`Dear ${f.salutation},`, false]]);
  xml = setPara(xml, /^We are pleased to extend this offer/, [
    [`We are pleased to extend this offer of employment for the position of ${article(f.position)} `, false], [f.position, true],
    [` at Lallubhai Amichand Ltd. This letter outlines the terms and conditions of your employment with our company, effective from ${start}.`, false]]);
  xml = setPara(xml, /^Your role as/, [[`Your role as ${f.position} is pivotal to our organisation, and we have every confidence that you will excel in `
    + `${f.focus || 'your responsibilities'} to meet our quality and efficiency goals. Your responsibilities will include, but are not limited to:`, false]]);
  xml = setPara(xml, /^You will assume the role of/, [['You will assume the role of ', false], [f.position, true],
    [` responsible for but not limited to ${f.focus || 'the duties assigned to you'}.`, false]]);
  xml = setPara(xml, /^Your starting monthly salary/, [[`Your starting monthly salary will be Rs. ${inr(f.salary)}/- (Rupees ${inWords(f.salary)} only). `
    + 'Salary will be payable between the 10th to 15th of every month and will include applicable deductions such as Professional Tax as per prevailing laws. '
    + 'You shall also be eligible for Bonus as per the Payment of Bonus Act.', false]]);
  xml = setPara(xml, /eligible for Provident Fund/, [[f.pf ? 'You are eligible for Provident Fund (PF) & ESIC as per the applicable laws.'
    : 'You are not eligible for Provident Fund (PF) & ESIC', true]]);
  for (const [label, k] of [['Basic Salary', 'basic'], ['HRA', 'hra'], ['Conveyance', 'conveyance'], ['Medical', 'medical'], ['Telephone', 'telephone'], ['Gross', 'gross']]) {
    xml = setCell(xml, label, f[k] ? `Rs. ${inr(f[k])}/-` : '-');
  }
  const pw = inWords(f.probation).toLowerCase();
  xml = setPara(xml, /^You will be on probation/, [[`You will be on probation for a period of ${f.probation} (${pw}) months commencing from ${start}. `
    + 'The Company will give you one month’s notice if the Company is not satisfied with your work within this Period.', false]]);
  xml = setPara(xml, /^9:30 am to 6:00 pm|Saturday of the month/, [[f.hours.endsWith(',') ? f.hours : f.hours + ',', false]]);
  return xml;
}

// → { buffer, fileName }
function buildLetter(type, fields) {
  if (!TEMPLATES[type]) throw Object.assign(new Error('Choose the offer or the appointment letter'), { userError: true });
  const f = clean(fields);
  const zip = new AdmZip(fs.readFileSync(TEMPLATES[type]));
  const entry = zip.getEntry('word/document.xml');
  let xml = entry.getData().toString('utf8');
  xml = type === 'offer' ? offerXml(xml, f) : appointmentXml(xml, f);
  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
  const who = f.name.replace(/[^\w .-]+/g, '').trim() || 'Candidate';
  return { buffer: zip.toBuffer(), fileName: `${type === 'offer' ? 'Offer Letter' : 'Appointment Letter'} - ${who}.docx`, fields: f };
}

module.exports = { buildLetter, inWords, longDate, DEFAULT_HOURS };
