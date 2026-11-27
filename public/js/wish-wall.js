/* Birthday Wish Wall (Dashboard strip + modals). Server: backend/wish-wall.js.
   WishWall.paint(box)         — fills the Dashboard strip, hides it when empty
   WishWall.openStart(users)   — Admin/HOD: start a wall for someone today
   The birthday person never gets their own wall from /today; once it is
   delivered they get `for_me` instead, which opens the surprise once. */
(function () {
  const NOTE = ['#fef3c7', '#fce7f3', '#dbeafe', '#dcfce7', '#ede9fe', '#ffedd5'];
  const esc = (s) => (window.Utils?.esc ? Utils.esc(s) : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const hourLabel = (h) => { const x = h % 12 || 12; return `${x} ${h < 12 ? 'AM' : 'PM'}`; };
  let _box = null;
  let _data = null;

  function notes(list, opts = {}) {
    if (!list.length) return `<div style="text-align:center;color:#94a3b8;font-size:13px;padding:18px 0;">${opts.empty || 'No wishes yet — be the first!'}</div>`;
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${opts.min || 190}px,1fr));gap:12px;">
      ${list.map((w, i) => `
        <div style="background:${NOTE[i % NOTE.length]};border-radius:12px;padding:12px 14px;box-shadow:0 3px 8px rgba(15,23,42,.08);transform:rotate(${((i % 5) - 2) * 0.6}deg);">
          <div style="color:#1f2937;font-size:${opts.big ? 15 : 13}px;line-height:1.55;white-space:pre-wrap;word-break:break-word;">${esc(w.message)}</div>
          <div style="color:#6b7280;font-size:11.5px;font-weight:700;margin-top:8px;">— ${esc(w.user_name)}${w.mine ? ' (you)' : ''}${w.department ? ' · ' + esc(w.department) : ''}</div>
        </div>`).join('')}
    </div>`;
  }

  function modal(id, inner, maxW = 620) {
    document.getElementById(id)?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div id="${id}" style="position:fixed;inset:0;background:rgba(15,23,42,.5);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div data-ww-card style="background:#fffdf7;border-radius:20px;box-shadow:0 20px 48px rgba(0,0,0,.18);width:100%;max-width:${maxW}px;max-height:90vh;overflow:auto;position:relative;">${inner}</div>
      </div>`);
    const el = document.getElementById(id);
    const close = () => el.remove();
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-ww-close]')) close(); });
    return { el, close };
  }

  /* ── Writer: write / edit my wish, see the others ── */
  function openWrite(w) {
    const { el, close } = modal('ww-write', `
      <div style="padding:20px 22px 14px;border-bottom:1px solid #f3e8d2;display:flex;gap:12px;align-items:center;">
        <div style="font-size:30px;">🎂</div>
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:800;color:#92400e;">Wish ${esc(w.person_name)} a happy birthday</div>
          <div style="font-size:12px;color:#a16207;margin-top:2px;">🤫 Secret — ${esc(w.person_name)} can't see this. All wishes reach them together at ${hourLabel(_data.deliver_hour)}.</div>
        </div>
        <button type="button" data-ww-close style="width:30px;height:30px;border-radius:8px;border:none;background:#fef3c7;color:#92400e;cursor:pointer;font-size:15px;">✕</button>
      </div>
      <div style="padding:18px 22px;">
        <textarea id="ww-msg" rows="4" maxlength="1000" placeholder="Write something from the heart… 🎉" style="width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid #fcd34d;border-radius:12px;font-size:14px;line-height:1.5;color:#1f2937;background:#fff;outline:none;resize:vertical;">${esc(w.my_wish)}</textarea>
        <div id="ww-err" style="display:none;font-size:12px;color:#dc2626;margin-top:6px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
          ${w.my_wish ? '<button type="button" id="ww-remove" class="btn-secondary">Remove my wish</button>' : ''}
          <button type="button" id="ww-save" style="padding:9px 22px;border-radius:10px;border:none;background:#d97706;color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(217,119,6,.35);">${w.my_wish ? 'Update wish' : 'Add my wish 🎁'}</button>
        </div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#a16207;margin:20px 0 10px;">On the wall · ${w.count}</div>
        ${notes(w.wishes)}
      </div>`);
    const msg = el.querySelector('#ww-msg');
    msg.focus();
    const send = async (message) => {
      const btn = el.querySelector('#ww-save');
      btn.disabled = true;
      try {
        await Utils.apiFetch(`/api/wishwall/${encodeURIComponent(w.id)}/wish`, { method: 'POST', body: JSON.stringify({ message }) });
        close();
        Utils.showToast(message ? 'Wish added — shhh, it\'s a secret! 🤫' : 'Wish removed', 'success');
        paint(_box);
      } catch (e) {
        const err = el.querySelector('#ww-err');
        err.textContent = e.message || 'Could not save'; err.style.display = 'block';
        btn.disabled = false;
      }
    };
    el.querySelector('#ww-save').onclick = () => {
      const m = msg.value.trim();
      if (!m) { const err = el.querySelector('#ww-err'); err.textContent = 'Write a wish first'; err.style.display = 'block'; return; }
      send(m);
    };
    const rm = el.querySelector('#ww-remove');
    if (rm) rm.onclick = () => send('');
  }

  /* ── Birthday person: the surprise ── */
  function confetti(host) {
    const bits = ['🎉', '🎊', '🎈', '✨', '🎂', '💛', '🌸'];
    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:20px;';
    for (let i = 0; i < 28; i++) {
      const s = document.createElement('span');
      s.textContent = bits[i % bits.length];
      s.style.cssText = `position:absolute;top:-30px;left:${Math.random() * 100}%;font-size:${16 + Math.random() * 14}px;`
        + `animation:wwfall ${2.4 + Math.random() * 2}s ${Math.random() * 1.2}s ease-in forwards;`;
      layer.appendChild(s);
    }
    host.appendChild(layer);
    setTimeout(() => layer.remove(), 5500);
  }
  /* ── Keepsake card: one tall PNG with every wish as a sticky note ──
     Drawn on a canvas in the browser, so it needs no server library and
     can be shared on WhatsApp as it is. */
  function loadImg(src) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  }
  function wrapLines(ctx, txt, maxW) {
    const out = [];
    for (const para of String(txt || '').split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        // A single word wider than the note is broken by characters.
        let wd = word;
        while (ctx.measureText(wd).width > maxW) {
          let k = wd.length; while (k > 1 && ctx.measureText(wd.slice(0, k)).width > maxW) k--;
          if (line) { out.push(line); line = ''; }
          out.push(wd.slice(0, k)); wd = wd.slice(k);
        }
        const t = line ? line + ' ' + wd : wd;
        if (ctx.measureText(t).width > maxW && line) { out.push(line); line = wd; } else line = t;
      }
      out.push(line);
    }
    while (out.length > 1 && !out[out.length - 1]) out.pop();
    return out;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  async function cardImage(w, day) {
    const W = 1200, PAD = 70, GAP = 28, COLS = w.wishes.length > 2 ? 2 : 1;
    const noteW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
    const FONT = '"Segoe UI", "Noto Sans", Arial, sans-serif';
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    // Measure every note first, then pack them into the shorter column.
    ctx.font = `26px ${FONT}`;
    const notesM = w.wishes.map((n) => {
      const lines = wrapLines(ctx, n.message, noteW - 56);
      return { n, lines, h: 40 + lines.length * 38 + 20 + 30 + 34 };
    });
    const HEAD = 470, FOOT = 150;
    const colH = Array(COLS).fill(0);
    const placed = notesM.map((m) => {
      const ci = colH.indexOf(Math.min(...colH));
      const p = { ...m, x: PAD + ci * (noteW + GAP), y: HEAD + colH[ci] };
      colH[ci] += m.h + GAP;
      return p;
    });
    const H = HEAD + Math.max(...colH, 0) + FOOT;
    const scale = 2;   // crisp on phones
    c.width = W * scale; c.height = H * scale;
    ctx.scale(scale, scale);

    // Background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#fff7e6'); bg.addColorStop(0.5, '#fffdf7'); bg.addColorStop(1, '#fdeef6');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // Confetti dots, the same on every render of the same wall
    let seed = [...w.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const dots = ['#f59e0b', '#ec4899', '#8b5cf6', '#10b981', '#3b82f6', '#f97316'];
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = dots[i % dots.length]; ctx.globalAlpha = 0.18 + rnd() * 0.3;
      const x = rnd() * W, y = rnd() < 0.7 ? rnd() * HEAD : rnd() * H, s = 4 + rnd() * 9;
      // keep the name, the line under it and the footer clean
      if ((x > 230 && x < W - 230 && y > 250 && y < 440) || y > H - 130) continue;
      if (i % 3) { ctx.beginPath(); ctx.arc(x, y, s / 2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * 3); ctx.fillRect(-s, -s / 4, s * 2, s / 2); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
    // Gold frame
    ctx.strokeStyle = '#e9c46a'; ctx.lineWidth = 3; roundRect(ctx, 22, 22, W - 44, H - 44, 28); ctx.stroke();
    ctx.strokeStyle = 'rgba(233,196,106,.45)'; ctx.lineWidth = 1.5; roundRect(ctx, 34, 34, W - 68, H - 68, 22); ctx.stroke();

    // Header
    const logo = await loadImg('/logo.png');
    if (logo) { const lh = 62, lw = logo.width * (lh / logo.height); ctx.drawImage(logo, (W - lw) / 2, 62, lw, lh); }
    ctx.textAlign = 'center';
    ctx.font = `86px ${FONT}`; ctx.fillText('🎂', W / 2, 225);
    ctx.fillStyle = '#b45309'; ctx.font = `600 34px ${FONT}`;
    ctx.fillText('H A P P Y   B I R T H D A Y', W / 2, 290);
    const name = w.person_name || '';
    let fs = 76; ctx.font = `800 ${fs}px ${FONT}`;
    while (ctx.measureText(name).width > W - 2 * PAD && fs > 40) { fs -= 4; ctx.font = `800 ${fs}px ${FONT}`; }
    const ng = ctx.createLinearGradient(W / 2 - 300, 0, W / 2 + 300, 0);
    ng.addColorStop(0, '#d97706'); ng.addColorStop(1, '#db2777');
    ctx.fillStyle = ng; ctx.fillText(name, W / 2, 372);
    ctx.fillStyle = '#78716c'; ctx.font = `24px ${FONT}`;
    ctx.fillText(`${w.wishes.length} wish${w.wishes.length === 1 ? '' : 'es'} from your team, written just for you 💛`, W / 2, 420);
    ctx.textAlign = 'left';

    // Notes
    placed.forEach((p, i) => {
      ctx.save();
      ctx.translate(p.x + noteW / 2, p.y + p.h / 2);
      ctx.rotate((((i % 5) - 2) * 0.5) * Math.PI / 180);
      ctx.translate(-noteW / 2, -p.h / 2);
      ctx.shadowColor = 'rgba(15,23,42,.12)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
      ctx.fillStyle = NOTE[i % NOTE.length]; roundRect(ctx, 0, 0, noteW, p.h, 18); ctx.fill();
      ctx.shadowColor = 'transparent';
      // a strip of "tape"
      ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.fillRect(noteW / 2 - 45, -10, 90, 22);
      ctx.fillStyle = '#1f2937'; ctx.font = `26px ${FONT}`;
      p.lines.forEach((ln, k) => ctx.fillText(ln, 28, 40 + 26 + k * 38));
      ctx.fillStyle = '#6b7280'; ctx.font = `700 21px ${FONT}`;
      let by = '— ' + (p.n.user_name || '') + (p.n.department ? ' · ' + p.n.department : '');
      while (ctx.measureText(by).width > noteW - 56 && by.length > 4) by = by.slice(0, -2) + '…';
      ctx.fillText(by, 28, p.h - 26);
      ctx.restore();
    });

    // Footer
    ctx.textAlign = 'center';
    ctx.fillStyle = '#a16207'; ctx.font = `600 24px ${FONT}`;
    ctx.fillText('With love, from everyone at Lallubhai Amichand Limited', W / 2, H - 92);
    const dt = day ? new Date(day + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    ctx.fillStyle = '#a8a29e'; ctx.font = `20px ${FONT}`;
    if (dt) ctx.fillText(dt, W / 2, H - 60);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }
  async function downloadCard(w, day, btn) {
    const old = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.textContent = 'Making card…'; }
    try {
      const blob = await cardImage(w, day);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Happy-Birthday-${String(w.person_name || 'card').trim().replace(/[^\w-]+/g, '-')}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { Utils.showToast('Could not make the card: ' + (e.message || e), 'error'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
  }

  function openSurprise(w) {
    if (!document.getElementById('ww-kf')) {
      document.head.insertAdjacentHTML('beforeend', '<style id="ww-kf">@keyframes wwfall{to{transform:translateY(105vh) rotate(540deg);opacity:.2}}</style>');
    }
    const first = (w.person_name || '').split(' ')[0];
    const { el } = modal('ww-surprise', `
      <button type="button" data-ww-close style="position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:8px;border:none;background:#fef3c7;color:#92400e;cursor:pointer;font-size:15px;z-index:2;">✕</button>
      <div style="padding:30px 26px 10px;text-align:center;">
        <div style="font-size:52px;line-height:1;">🎂</div>
        <div style="font-size:26px;font-weight:800;color:#b45309;margin-top:12px;">Happy Birthday, ${esc(first)}!</div>
        <div style="font-size:14px;color:#78716c;margin-top:6px;">Your team kept a secret today — <b>${w.wishes.length} wish${w.wishes.length === 1 ? '' : 'es'}</b>, written just for you 💛</div>
      </div>
      <div style="padding:16px 24px 26px;">${notes(w.wishes, { big: true, min: 220 })}</div>
      <div style="text-align:center;padding:0 0 12px;">
        <button type="button" id="ww-dl" style="background:#db2777;color:#fff;border:none;border-radius:10px;padding:10px 22px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(219,39,119,.35);">🖼️ Download as card</button>
      </div>
      <div style="text-align:center;color:#a8a29e;font-size:12px;padding:0 0 20px;">With love, from everyone at Lallubhai Amichand</div>`, 760);
    el.querySelector('#ww-dl').onclick = (e) => downloadCard(w, w.day || _data?.day, e.currentTarget);
    confetti(el.querySelector('[data-ww-card]'));
    try { localStorage.setItem('ww-seen-' + w.id, '1'); } catch { /* private mode */ }
  }

  /* ── Admin/HOD: start a wall ── */
  function openStart(users) {
    const me = String(window.currentUser?.id || '');
    const list = (users || []).filter((u) => u.active !== false && u.active !== 0 && String(u.id) !== me)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const { el, close } = modal('ww-start', `
      <div style="padding:20px 22px;border-bottom:1px solid #f3e8d2;display:flex;gap:12px;align-items:center;">
        <div style="font-size:28px;">🎂</div>
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:800;color:#92400e;">Start a birthday Wish Wall</div>
          <div style="font-size:12px;color:#a16207;margin-top:2px;">Everyone except that person sees it on the Dashboard today. Wishes go to them at ${hourLabel(_data?.deliver_hour ?? 18)}.</div>
        </div>
        <button type="button" data-ww-close style="width:30px;height:30px;border-radius:8px;border:none;background:#fef3c7;color:#92400e;cursor:pointer;font-size:15px;">✕</button>
      </div>
      <div style="padding:18px 22px;">
        <label style="display:block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:5px;">Whose birthday is it?</label>
        <select id="ww-who" style="width:100%;padding:9px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;background:#fff;">
          <option value="">— Pick —</option>
          ${list.map((u) => `<option value="${esc(u.id)}">${esc(u.name || u.email)}${u.department ? ' · ' + esc(u.department) : ''}</option>`).join('')}
        </select>
        <div id="ww-serr" style="display:none;font-size:12px;color:#dc2626;margin-top:6px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
          <button type="button" data-ww-close class="btn-secondary">Cancel</button>
          <button type="button" id="ww-go" style="padding:8px 18px;border-radius:8px;border:none;background:#d97706;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">Start Wish Wall</button>
        </div>
      </div>`, 460);
    el.querySelector('#ww-go').onclick = async () => {
      const id = el.querySelector('#ww-who').value;
      const err = el.querySelector('#ww-serr');
      if (!id) { err.textContent = 'Pick the person'; err.style.display = 'block'; return; }
      try {
        const r = await Utils.apiFetch('/api/wishwall', { method: 'POST', body: JSON.stringify({ user_id: id }) });
        close();
        Utils.showToast(r.existed ? 'Their wall is already up' : 'Wish Wall started 🎉', 'success');
        paint(_box);
      } catch (e) { err.textContent = e.message || 'Could not start'; err.style.display = 'block'; }
    };
  }

  /* ── The Dashboard strip ── */
  async function paint(box) {
    _box = box;
    if (!box) return;
    const d = await Utils.apiFetch('/api/wishwall/today').catch(() => null);
    _data = d;
    if (!d || (!d.walls.length && !d.for_me.length)) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const cards = [];
    for (const w of d.for_me) {
      cards.push(`
        <div class="card db-hero" style="background:linear-gradient(135deg,rgba(236,72,153,.16),rgba(245,158,11,.10)),var(--surface,#fff);border:1px solid rgba(236,72,153,.25);">
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <span class="db-ic" style="width:48px;height:48px;border-radius:14px;background:rgba(236,72,153,.15);font-size:25px;display:flex;align-items:center;justify-content:center;">🎁</span>
            <div style="flex:1;min-width:180px;">
              <div class="db-hero-label" style="color:#db2777;">Happy Birthday 🎂</div>
              <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-top:3px;">Your team wrote you ${w.wishes.length} secret wish${w.wishes.length === 1 ? '' : 'es'}!</div>
            </div>
            <button type="button" data-ww-card="${esc(w.id)}" class="btn-secondary btn-sm" title="Download all wishes as an image">🖼️ Card</button>
            <button type="button" data-ww-open="${esc(w.id)}" style="background:#db2777;color:#fff;border:none;border-radius:10px;padding:9px 20px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(219,39,119,.35);">Open 💌</button>
          </div>
        </div>`);
    }
    for (const w of d.walls) {
      const first = (w.person_name || '').split(' ')[0];
      cards.push(`
        <div class="card db-hero" style="background:linear-gradient(135deg,rgba(245,158,11,.18),rgba(236,72,153,.08)),var(--surface,#fff);border:1px solid rgba(245,158,11,.3);">
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <span class="db-ic" style="width:48px;height:48px;border-radius:14px;background:rgba(245,158,11,.2);font-size:25px;display:flex;align-items:center;justify-content:center;">🎂</span>
            <div style="flex:1;min-width:200px;">
              <div class="db-hero-label" style="color:#b45309;">Birthday Wish Wall · 🤫 secret</div>
              <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-top:3px;">
                ${w.delivered ? `🎉 ${w.count} wish${w.count === 1 ? '' : 'es'} delivered to ${esc(w.person_name)}!`
                  : `Aaj ${esc(w.person_name)} ka birthday hai! Chupke se wish likho`}
              </div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
                ${w.delivered ? 'Thank you, everyone 💛' : `${w.count} wish${w.count === 1 ? '' : 'es'} so far · ${esc(first)} gets them all together at ${hourLabel(d.deliver_hour)} — don't tell!`}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${w.delivered && w.count ? `<button type="button" data-ww-card="${esc(w.id)}" class="btn-secondary btn-sm" title="Download all wishes as an image">🖼️ Download card</button>` : ''}
              ${w.delivered ? '' : `<button type="button" data-ww-write="${esc(w.id)}" style="background:#d97706;color:#fff;border:none;border-radius:10px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(217,119,6,.35);">${w.my_wish ? '✏️ Edit my wish' : '✍️ Write a wish'}</button>`}
              ${d.manage && !w.delivered ? `<button type="button" data-ww-deliver="${esc(w.id)}" class="btn-secondary btn-sm" title="Send all wishes to ${esc(w.person_name)} now">Deliver now</button>` : ''}
              ${d.manage ? `<button type="button" data-ww-del="${esc(w.id)}" class="btn-secondary btn-sm" title="Remove this wall">✕</button>` : ''}
            </div>
          </div>
        </div>`);
    }
    box.style.display = '';
    box.innerHTML = `<div style="display:grid;gap:10px;">${cards.join('')}</div>`;

    box.querySelectorAll('[data-ww-write]').forEach((b) => { b.onclick = () => openWrite(d.walls.find((w) => w.id === b.dataset.wwWrite)); });
    box.querySelectorAll('[data-ww-card]').forEach((b) => {
      b.onclick = () => {
        const w = d.for_me.find((x) => x.id === b.dataset.wwCard) || d.walls.find((x) => x.id === b.dataset.wwCard);
        downloadCard(w, w.day || d.day, b);
      };
    });
    box.querySelectorAll('[data-ww-open]').forEach((b) => { b.onclick = () => openSurprise(d.for_me.find((w) => w.id === b.dataset.wwOpen)); });
    box.querySelectorAll('[data-ww-deliver]').forEach((b) => {
      b.onclick = async () => {
        const w = d.walls.find((x) => x.id === b.dataset.wwDeliver);
        if (!(await Utils.showConfirm(`Send all ${w.count} wish(es) to ${w.person_name} now? After this nobody can add more.`, { title: 'Deliver wishes', confirmText: 'Deliver now' }))) return;
        try {
          const r = await Utils.apiFetch(`/api/wishwall/${encodeURIComponent(w.id)}/deliver`, { method: 'POST' });
          Utils.showToast(r.sent ? `Delivered to ${r.to} 🎉` : (r.reason || 'Delivered on the Dashboard'), r.sent ? 'success' : 'info');
          paint(box);
        } catch (e) { Utils.showToast(e.message || 'Could not deliver', 'error'); }
      };
    });
    box.querySelectorAll('[data-ww-del]').forEach((b) => {
      b.onclick = async () => {
        if (!(await Utils.showConfirm('Remove this Wish Wall and every wish on it?', { title: 'Remove Wish Wall', confirmText: 'Remove', danger: true }))) return;
        try { await Utils.apiFetch(`/api/wishwall/${encodeURIComponent(b.dataset.wwDel)}`, { method: 'DELETE' }); paint(box); }
        catch (e) { Utils.showToast(e.message || 'Could not remove', 'error'); }
      };
    });

    // The surprise opens by itself, once per wall.
    const fresh = d.for_me.find((w) => { try { return !localStorage.getItem('ww-seen-' + w.id); } catch { return false; } });
    if (fresh && !document.getElementById('ww-surprise')) setTimeout(() => openSurprise(fresh), 700);
  }

  window.WishWall = { paint, openStart, cardImage, refresh: () => paint(_box) };
})();
