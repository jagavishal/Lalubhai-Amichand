'use strict';
/* =====================================================================
   Birthday Wish Wall — the team writes wishes in secret, the birthday
   person gets them all together in the evening.
   ---------------------------------------------------------------------
   27 Nov 2026 (Saloni's birthday): "Wish Wall, jo team chupke se bhare".

     - A wall is one person on one IST day. It opens by itself for every
       Active employee whose HR date of birth is today (needs e.user_id to
       know whom to hide it from), and an Admin/HOD can also start one by
       hand for any login (manual = for when the DOB is missing or wrong).
     - Everybody except that person sees the wall on the Dashboard and
       writes one wish (editable until it is delivered). The person never
       sees it: walls are filtered out by their user id AND their email.
     - At DELIVER_HOUR IST (app_config 'wishwall_hour', default 18) the
       sweep mails all the wishes to the person, and from then on their
       Dashboard shows a "your team wrote you N wishes" card that opens
       the wall. An Admin/HOD can also press "Deliver now".
     - Works in local JSON mode too (database/wish-wall.json); the HR
       auto-open only runs with the DB.
   ===================================================================== */

const fsp = require('fs').promises;
const path = require('path');

const JSON_FILE = path.join(__dirname, '..', 'database', 'wish-wall.json');
const DEFAULT_HOUR = 18;   // end of the 09:30–18:00 shift

const WISHWALL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS wish_walls (
     id VARCHAR(24) PRIMARY KEY,
     day DATE NOT NULL,
     person_user_id VARCHAR(64) DEFAULT '',
     person_name VARCHAR(255) NOT NULL,
     person_email VARCHAR(255) DEFAULT '',
     source VARCHAR(16) DEFAULT 'manual',
     created_by VARCHAR(255) DEFAULT '',
     delivered_at BIGINT NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE KEY uq_wishwall_day_person (day, person_user_id),
     KEY idx_wishwall_day (day)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS wish_wall_entries (
     id INT AUTO_INCREMENT PRIMARY KEY,
     wall_id VARCHAR(24) NOT NULL,
     user_id VARCHAR(64) NOT NULL,
     user_name VARCHAR(255) DEFAULT '',
     department VARCHAR(128) DEFAULT '',
     message TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     UNIQUE KEY uq_wishwall_entry (wall_id, user_id),
     KEY idx_wishwall_entry_wall (wall_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const bad = (msg, status) => { throw new UserError(msg, status); };
const str = (v, max = 255) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const text = (v, max = 1000) => String(v ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const dOut = (v) => (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : (v ? String(v).slice(0, 10) : ''));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const low = (s) => String(s || '').trim().toLowerCase();

// Sticky-note colours, the same order on the page and in the mail.
const NOTE_COLOURS = ['#fef3c7', '#fce7f3', '#dbeafe', '#dcfce7', '#ede9fe', '#ffedd5'];

function mountWishWall(app, ctx) {
  const { q, pool, ensureSchema, requireAuth, isAdminUser, isSuperAdmin, istToday, useDb,
    getMailer, findUser, resolveEmail, todaysBirthdays } = ctx;
  const BASE = '/api/wishwall';
  const canManage = (u) => isSuperAdmin(u) || isAdminUser(u);

  /* ── Storage ── */
  async function readFile() {
    try {
      const d = JSON.parse(await fsp.readFile(JSON_FILE, 'utf8'));
      return { walls: d.walls || [], entries: d.entries || [] };
    } catch { return { walls: [], entries: [] }; }
  }
  async function writeFile(d) {
    await fsp.mkdir(path.dirname(JSON_FILE), { recursive: true });
    await fsp.writeFile(JSON_FILE, JSON.stringify(d, null, 1));
  }
  const wOut = (r) => ({
    id: r.id, day: dOut(r.day), person_user_id: String(r.person_user_id || ''), person_name: r.person_name || '',
    person_email: r.person_email || '', source: r.source || 'manual', created_by: r.created_by || '',
    delivered_at: r.delivered_at == null ? null : Number(r.delivered_at),
  });
  const eOut = (r) => ({
    id: Number(r.id), wall_id: r.wall_id, user_id: String(r.user_id), user_name: r.user_name || '',
    department: r.department || '', message: r.message || '', created_at: Number(r.created_at) || 0,
  });

  const store = {
    async wallsOn(day) {
      if (!useDb) return (await readFile()).walls.filter((w) => w.day === day);
      return (await q('SELECT * FROM wish_walls WHERE day = $1 ORDER BY created_at', [day])).map(wOut);
    },
    async wall(id) {
      if (!useDb) return (await readFile()).walls.find((w) => w.id === id) || null;
      const r = await q('SELECT * FROM wish_walls WHERE id = $1', [id]);
      return r[0] ? wOut(r[0]) : null;
    },
    // Walls for this person, newest first — their own "your wishes" card.
    async wallsFor(uid, email) {
      const mine = (w) => (uid && w.person_user_id === uid) || (email && low(w.person_email) === email);
      if (!useDb) return (await readFile()).walls.filter(mine).sort((a, b) => b.day.localeCompare(a.day));
      const rows = await q('SELECT * FROM wish_walls WHERE person_user_id = $1 OR LOWER(person_email) = $2 ORDER BY day DESC', [uid, email || '-']);
      return rows.map(wOut);
    },
    // One wall per person per day; the second start is a no-op.
    async createWall(w) {
      if (!useDb) {
        const d = await readFile();
        if (!d.walls.some((x) => x.day === w.day && x.person_user_id === w.person_user_id)) { d.walls.push(w); await writeFile(d); }
        return;
      }
      await q(`INSERT IGNORE INTO wish_walls (id, day, person_user_id, person_name, person_email, source, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [w.id, w.day, w.person_user_id, w.person_name, w.person_email, w.source, w.created_by]);
    },
    async deleteWall(id) {
      if (!useDb) {
        const d = await readFile();
        d.walls = d.walls.filter((w) => w.id !== id);
        d.entries = d.entries.filter((e) => e.wall_id !== id);
        return writeFile(d);
      }
      await q('DELETE FROM wish_wall_entries WHERE wall_id = $1', [id]);
      await q('DELETE FROM wish_walls WHERE id = $1', [id]);
    },
    // Returns true only for the call that actually flipped it, so two sweeps
    // cannot both mail the same wall.
    async markDelivered(id, at) {
      if (!useDb) {
        const d = await readFile();
        const w = d.walls.find((x) => x.id === id && x.delivered_at == null);
        if (!w) return false;
        w.delivered_at = at; await writeFile(d); return true;
      }
      const r = await pool.query('UPDATE wish_walls SET delivered_at = $1 WHERE id = $2 AND delivered_at IS NULL', [at, id]);
      return Number(r?.rowCount) > 0;
    },
    async entries(wallIds) {
      if (!wallIds.length) return [];
      if (!useDb) return (await readFile()).entries.filter((e) => wallIds.includes(e.wall_id)).sort((a, b) => a.created_at - b.created_at);
      const ph = wallIds.map((_, i) => '$' + (i + 1)).join(',');
      return (await q(`SELECT * FROM wish_wall_entries WHERE wall_id IN (${ph}) ORDER BY created_at, id`, wallIds)).map(eOut);
    },
    async saveEntry(e) {
      if (!useDb) {
        const d = await readFile();
        const x = d.entries.find((y) => y.wall_id === e.wall_id && y.user_id === e.user_id);
        if (x) x.message = e.message;
        else { e.id = d.entries.reduce((m, y) => Math.max(m, y.id), 0) + 1; d.entries.push(e); }
        return writeFile(d);
      }
      const ex = await q('SELECT id FROM wish_wall_entries WHERE wall_id = $1 AND user_id = $2', [e.wall_id, e.user_id]);
      if (ex.length) await q('UPDATE wish_wall_entries SET message = $1 WHERE id = $2', [e.message, ex[0].id]);
      else await q('INSERT INTO wish_wall_entries (wall_id, user_id, user_name, department, message, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [e.wall_id, e.user_id, e.user_name, e.department, e.message, e.created_at]);
    },
    async deleteEntry(wallId, userId) {
      if (!useDb) { const d = await readFile(); d.entries = d.entries.filter((e) => !(e.wall_id === wallId && e.user_id === userId)); return writeFile(d); }
      await q('DELETE FROM wish_wall_entries WHERE wall_id = $1 AND user_id = $2', [wallId, userId]);
    },
  };

  const newId = (day) => 'WW' + day.replace(/-/g, '') + Math.random().toString(36).slice(2, 8).toUpperCase();

  /* ── Today's walls: HR birthdays open by themselves ── */
  let _autoDay = '';
  async function ensureAutoWalls(day) {
    if (!useDb || _autoDay === day || typeof todaysBirthdays !== 'function') return;
    _autoDay = day;
    try {
      for (const b of await todaysBirthdays()) {
        if (!b.user_id) continue;
        await store.createWall({
          id: newId(day), day, person_user_id: String(b.user_id), person_name: str(b.name),
          person_email: str(b.email), source: 'hr', created_by: 'HR birthday', delivered_at: null,
        });
      }
    } catch (e) { _autoDay = ''; console.error('[wishwall] auto-open failed:', e.message); }
  }

  async function deliverHour() {
    if (!useDb) return DEFAULT_HOUR;
    try {
      const h = await q(`SELECT "value" FROM app_config WHERE "key" = 'wishwall_hour'`);
      if (h[0] && String(h[0].value).trim() !== '' && Number.isFinite(+h[0].value)) return Math.min(23, Math.max(0, +h[0].value));
    } catch { /* default */ }
    return DEFAULT_HOUR;
  }

  /* ── The mail ── */
  function mailHtml(w, list) {
    const notes = list.map((e, i) => `
      <div style="background:${NOTE_COLOURS[i % NOTE_COLOURS.length]};border-radius:10px;padding:14px 16px;margin:0 0 12px;text-align:left">
        <div style="color:#1f2937;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(e.message)}</div>
        <div style="color:#6b7280;font-size:12px;font-weight:bold;margin-top:8px">— ${esc(e.user_name)}${e.department ? ' · ' + esc(e.department) : ''}</div>
      </div>`).join('');
    return `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;border:1px solid #f1d6a8;border-radius:14px;background:#fffdf7;text-align:center">
        <div style="font-size:44px;line-height:1">&#127874;&#127880;&#127881;</div>
        <h2 style="color:#b45309;margin:12px 0 6px">Happy Birthday, ${esc(w.person_name)}!</h2>
        <p style="color:#374151;font-size:14px;margin:0 0 22px">Your team kept a secret today — <b>${list.length} wish${list.length === 1 ? '' : 'es'}</b>, written just for you.</p>
        ${notes}
        <p style="color:#94a3b8;font-size:12px;margin-top:22px">With love, from everyone at Lallubhai Amichand Limited</p>
      </div>`;
  }

  async function deliver(w, { force = false } = {}) {
    const list = await store.entries([w.id]);
    if (!list.length && !force) return { sent: false, reason: 'No wishes yet' };
    if (!(await store.markDelivered(w.id, Date.now()))) return { sent: false, reason: 'Already delivered' };
    const mailer = getMailer();
    const to = w.person_user_id ? (await resolveEmail(w.person_user_id)) || w.person_email : w.person_email;
    if (!mailer || !to) {
      console.log('[wishwall] delivered on the Dashboard only for', w.person_name, mailer ? '— no email' : '— SMTP not configured');
      return { sent: false, reason: mailer ? 'No email for this person — they will still see it on the Dashboard' : 'SMTP not configured — shown on the Dashboard only', delivered: true };
    }
    try {
      await mailer.sendMail({
        from: `"Lallubhai Amichand" <${process.env.SMTP_USER}>`,
        to,
        subject: `🎂 Happy Birthday ${w.person_name}! Your team has ${list.length} wish${list.length === 1 ? '' : 'es'} for you`,
        html: mailHtml(w, list),
      });
      return { sent: true, delivered: true, to };
    } catch (e) {
      console.error('[wishwall] mail failed for', to, '—', e.message);
      return { sent: false, delivered: true, reason: 'Mail failed: ' + e.message };
    }
  }

  async function sweep() {
    const { iso, hour } = istToday();
    if (hour < (await deliverHour())) return;
    if (useDb) await ensureSchema();
    await ensureAutoWalls(iso);
    for (const w of await store.wallsOn(iso)) {
      if (w.delivered_at != null) continue;
      const r = await deliver(w);
      if (r.delivered) console.log('[wishwall] delivered', w.person_name, r.sent ? 'by mail' : '(' + r.reason + ')');
    }
  }
  setInterval(() => { sweep().catch((e) => console.error('[wishwall] sweep', e.message)); }, 10 * 60 * 1000).unref?.();
  setTimeout(() => { sweep().catch((e) => console.error('[wishwall] sweep', e.message)); }, 90 * 1000).unref?.();

  /* ── Routes ── */
  function route(fn, { manage = false } = {}) {
    return async (req, res) => {
      try {
        if (useDb) await ensureSchema();
        const user = req.session.user;
        if (manage && !canManage(user)) return res.status(403).json({ error: 'Only an Admin/HOD can do this' });
        req.ww = { user, uid: String(user.id), email: low(user.email), manage: canManage(user) };
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[wishwall]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }
  const isMe = (w, ww) => (w.person_user_id && w.person_user_id === ww.uid) || (w.person_email && low(w.person_email) === ww.email);

  // Everything the Dashboard needs: today's walls I may write on (never my
  // own) and, once delivered, my own walls to open.
  app.get(`${BASE}/today`, requireAuth, route(async (req) => {
    const { iso, hour } = istToday();
    await ensureAutoWalls(iso);
    const walls = (await store.wallsOn(iso)).filter((w) => !isMe(w, req.ww));
    const all = await store.entries(walls.map((w) => w.id));
    const hourAt = await deliverHour();
    const out = walls.map((w) => {
      const list = all.filter((e) => e.wall_id === w.id);
      const mine = list.find((e) => e.user_id === req.ww.uid);
      return {
        id: w.id, person_name: w.person_name, delivered: w.delivered_at != null, source: w.source,
        count: list.length, my_wish: mine ? mine.message : '',
        // Writers see each other's wishes — it is what makes people join in.
        wishes: list.map((e) => ({ user_name: e.user_name, department: e.department, message: e.message, mine: e.user_id === req.ww.uid })),
      };
    });
    // My own delivered walls from the last 7 days.
    const weekAgo = new Date(Date.parse(iso + 'T00:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);
    const minePending = (await store.wallsFor(req.ww.uid, req.ww.email)).filter((w) => w.day >= weekAgo);
    const myDelivered = minePending.filter((w) => w.delivered_at != null);
    const myEntries = await store.entries(myDelivered.map((w) => w.id));
    const forMe = myDelivered.map((w) => ({
      id: w.id, day: w.day, person_name: w.person_name,
      wishes: myEntries.filter((e) => e.wall_id === w.id).map((e) => ({ user_name: e.user_name, department: e.department, message: e.message })),
    })).filter((w) => w.wishes.length);
    return { day: iso, deliver_hour: hourAt, hour, manage: req.ww.manage, walls: out, for_me: forMe };
  }));

  app.post(`${BASE}/:id/wish`, requireAuth, route(async (req) => {
    const w = await store.wall(req.params.id);
    if (!w || w.day !== istToday().iso) bad('This wish wall is closed', 404);
    if (isMe(w, req.ww)) bad('Nice try — this one is a surprise for you!', 403);
    if (w.delivered_at != null) bad('The wishes have already been delivered');
    const message = text(req.body?.message, 1000);
    if (!message) {
      await store.deleteEntry(w.id, req.ww.uid);
      return { ok: true, removed: true };
    }
    const u = req.ww.user;
    await store.saveEntry({
      wall_id: w.id, user_id: req.ww.uid, user_name: str(u.name || u.email), department: str(u.department, 128),
      message, created_at: Date.now(),
    });
    return { ok: true };
  }));

  // Admin/HOD: start a wall for any login (today).
  app.post(BASE, requireAuth, route(async (req) => {
    const day = istToday().iso;
    const target = await findUser(String(req.body?.user_id || ''));
    if (!target) bad('Pick the person');
    if (String(target.id) === req.ww.uid) bad('You cannot start a surprise wall for yourself');
    const existing = (await store.wallsOn(day)).find((w) => w.person_user_id === String(target.id));
    if (existing) return { ok: true, id: existing.id, existed: true };
    const id = newId(day);
    await store.createWall({
      id, day, person_user_id: String(target.id), person_name: str(target.name || target.email),
      person_email: str(target.email), source: 'manual', created_by: str(req.ww.user.name || req.ww.user.email), delivered_at: null,
    });
    return { ok: true, id };
  }, { manage: true }));

  app.post(`${BASE}/:id/deliver`, requireAuth, route(async (req) => {
    const w = await store.wall(req.params.id);
    if (!w) bad('Wall not found', 404);
    if (isMe(w, req.ww)) bad('This one is for you!', 403);
    const r = await deliver(w);
    if (!r.delivered) bad(r.reason);
    return r;
  }, { manage: true }));

  app.delete(`${BASE}/:id`, requireAuth, route(async (req) => {
    const w = await store.wall(req.params.id);
    if (!w) bad('Wall not found', 404);
    if (isMe(w, req.ww)) bad('This one is for you!', 403);
    await store.deleteWall(w.id);
    return { ok: true };
  }, { manage: true }));

}

module.exports = { WISHWALL_SCHEMA, mountWishWall };
