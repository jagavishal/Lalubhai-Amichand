'use strict';
/**
 * The export team's own CBM / rate sheet, read for the Add Price screen.
 *
 * Sheet1 of the "PI Export (Final)" workbook (RATE_SOURCE in pi-format.js):
 * one row per item + size with the sheet's own cost, rate per kg and minimum
 * rate, then ONE COLUMN PER PARTY holding the last rate that party was
 * quoted ("XEBED ENTERPRISE (Mr. Obaid)", "Zam Zam", ...). Columns are found
 * by header, not by letter: the sheet is theirs and gets columns added as
 * buyers come and go.
 *
 * Pure functions over an already-fetched range, so they can be tested against
 * a dump of the real sheet without a Sheets client. server.js does the
 * fetching and caching.
 */

const PI = require('./pi-format');

function rateKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// "7", "7\"", "7 inch", "7''" are one size; "9X15 (7Pcs)" keeps its digits
// and letters so a 9X15 and a 9X18 stay apart.
function sizeKey(s) {
  return String(s || '').toLowerCase().replace(/inch(es)?|["'”″]+/g, '').replace(/[^a-z0-9.]+/g, '').replace(/\.0+$/, '');
}

function num(v) {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// rows[0] is the header row (RATE_SOURCE.headerRow); everything under it is
// data. Returns { items, parties }.
function parseRateSheet(rows, src = PI.RATE_SOURCE) {
  const header = ((rows && rows[0]) || []).map(h => String(h || '').trim());
  const col = {};
  for (const [k, re] of Object.entries(src.headerRe)) col[k] = header.findIndex(h => re.test(h));
  if (col.item < 0) throw new Error(`"${src.tab}" header row not recognised — no Item column`);
  const known = Object.values(col).filter(i => i >= 0);
  const partiesFrom = col[src.partiesAfter] >= 0 ? col[src.partiesAfter] + 1 : Math.max(...known) + 1;
  const parties = header
    .map((h, i) => ({ name: h, idx: i }))
    .filter(p => p.idx >= partiesFrom && p.name && !src.notPartyRe.test(p.name));
  const cell = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const items = (rows || []).slice(1)
    .filter(r => cell(r, col.item))
    .map(r => {
      const rates = {};
      for (const p of parties) { const v = num(r[p.idx]); if (v != null) rates[p.name] = v; }
      return {
        item: cell(r, col.item), size: cell(r, col.size), swg: cell(r, col.swg),
        weightPerPc: num(r[col.weightPerPc]), perBoxCbm: num(r[col.perBoxCbm]),
        cost: num(r[col.cost]), ratePerKg: num(r[col.ratePerKg]), minRate: num(r[col.minRate]),
        rates,
      };
    });
  return { items, parties };
}

// Which party column on that sheet is this buyer. The sheet's headers are the
// team's short names ("Al Saif Trading", "AL KATHIRY FOR TRADING (Mr. Obaid)")
// while the PI carries the buyer's full legal name, so the two are compared
// on their distinctive words only — legal-form words, Arabic name particles
// and the salesman's name in brackets are dropped first. A column matches
// when most of ITS words are in the buyer's name, or most of the buyer's
// words are in it; the strongest overlap wins.
const PARTY_STOP = new Set([
  'm', 's', 'ms', 'mr', 'mrs', 'trading', 'trd', 'trdg', 'traders', 'est', 'establishment', 'co', 'company', 'ltd', 'limited',
  'llc', 'wll', 'inc', 'corp', 'corporation', 'fzc', 'fze', 'fzco', 'for', 'and', 'the', 'of', 'household', 'general', 'gen',
  'direct', 'intl', 'international', 'imp', 'exp', 'import', 'export', 'impex', 'enterprise', 'enterprises', 'ent', 'stores',
  'store', 'shop', 'sons', 'bros', 'brothers', 'group', 'al', 'el', 'bin', 'ibn', 'abu', 'abdul', 'abd', 'cnf', 'fob', 'usd', 'us',
]);

function partyTokens(s) {
  return [...new Set(String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter(t => t.length >= 3 && !PARTY_STOP.has(t)))];
}

function matchParty(buyerName, parties) {
  const buyer = partyTokens(buyerName);
  if (!buyer.length) return null;
  let best = null, bestScore = 0;
  for (const p of parties) {
    const mine = partyTokens(p.name);
    if (!mine.length) continue;
    const overlap = mine.filter(t => buyer.includes(t)).length;
    if (!overlap) continue;
    const byParty = overlap / mine.length, byBuyer = overlap / buyer.length;
    if (byParty < 0.6 && byBuyer < 0.6) continue;
    const score = byParty + byBuyer;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

// One entry per PI line, in the PI's own order: the sheet row for that item
// and size (or null), and what the matched party column says there.
function sheetRatesFor(parsed, buyerName, items) {
  const { items: rows, parties } = parsed;
  const byKey = new Map(), byLoose = new Map();
  for (const r of rows) {
    const k = rateKey(r.item);
    if (!k) continue;
    if (!byKey.has(k + '|' + sizeKey(r.size))) byKey.set(k + '|' + sizeKey(r.size), r);
    // Size-blind fallback for a product the sheet lists at one size only.
    if (!byLoose.has(k)) byLoose.set(k, [r]); else byLoose.get(k).push(r);
  }
  const party = matchParty(buyerName, parties);
  return (items || []).map(it => {
    const name = rateKey(it.itemName || it.description);
    if (!name) return null;
    let row = byKey.get(name + '|' + sizeKey(it.size)) || null;
    if (!row) {
      const loose = byLoose.get(name) || [];
      if (loose.length === 1) row = loose[0];
    }
    if (!row) return { found: false, party: party ? party.name : '' };
    return {
      found: true,
      item: row.item, size: row.size,
      weightPerPc: row.weightPerPc, perBoxCbm: row.perBoxCbm,
      cost: row.cost, ratePerKg: row.ratePerKg, minRate: row.minRate,
      party: party ? party.name : '',
      partyRate: party ? (row.rates[party.name] ?? null) : null,
      // Every party's last rate for the line — the pricer often wants to see
      // what the neighbours paid, not only this buyer.
      others: Object.entries(row.rates).map(([p, rate]) => ({ party: p, rate })),
    };
  });
}

module.exports = { parseRateSheet, matchParty, sheetRatesFor, rateKey, sizeKey, partyTokens };
