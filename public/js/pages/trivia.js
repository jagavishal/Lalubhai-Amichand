/* =====================================================================
   Daily Trivia — one 30-second question a day, scores on a big screen.
   ---------------------------------------------------------------------
   Server side: backend/trivia.js (/api/trivia/*). The timer that counts
   is the server's — the countdown here is only the picture of it, and
   the question text arrives only after Start.

   Tabs: Today (play + today's ranking), Leaderboard (month +
   departments), Questions (Admin/HOD: the bank, CSV import, resetting a
   play). play() is also called from the dashboard card.
   The big screen is its own page: /trivia-screen.
   ===================================================================== */
window.Pages = window.Pages || {};

window.Pages.trivia = (() => {
  const H = window.HR;
  const esc = H.esc;
  const BASE = '/api/trivia';
  const LETTERS = ['A', 'B', 'C', 'D'];

  let T = null;      // /today
  let B = null;      // /board
  let Q = null;      // /questions (managers)
  let _tab = 'today';
  let _qf = { q: '', cat: 'All' };

  const sec = (t) => `<div style="margin-bottom:10px;">${H.sectionTitle(t)}</div>`;
  const secs = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(1) + 's');
  const medal = (i) => ['🥇', '🥈', '🥉'][i] || String(i + 1);
  const fmtDay = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  async function load() {
    [T, B] = await Promise.all([H.api(`${BASE}/today`), H.api(`${BASE}/board`)]);
    if (_tab === 'questions' && T.manage) Q = await H.api(`${BASE}/questions`);
  }
  async function refresh() { try { await load(); paint(); } catch (e) { H.fail(e); } }

  async function render() {
    const el = document.getElementById('main-content');
    if (!el) return;
    el.innerHTML = H.spinner();
    try { await load(); } catch (e) { el.innerHTML = H.empty('Could not load Daily Trivia', e.message); return; }
    paint();
  }

  function paint() {
    const el = document.getElementById('main-content');
    if (!el || !T) return;
    const tabs = [{ key: 'today', label: 'Today' }, { key: 'board', label: 'Leaderboard' }];
    if (T.manage) tabs.push({ key: 'questions', label: 'Questions' });
    if (!tabs.some((t) => t.key === _tab)) _tab = 'today';
    el.innerHTML = `<div style="max-width:1100px;margin:0 auto;">
      ${H.header('Daily Trivia', `One question a day · ${T.limitSec} seconds · one try`,
        `<a href="/trivia-screen" target="_blank" rel="noopener" class="btn-secondary" style="text-decoration:none;">📺 Big screen</a>`)}
      ${H.tabs('tv', tabs, _tab)}
      <div id="tv-body">${_tab === 'today' ? todayHtml() : _tab === 'board' ? boardHtml() : questionsHtml()}</div>
    </div>`;
    el.querySelectorAll('[data-tv-tab]').forEach((b) => b.addEventListener('click', async () => {
      _tab = b.dataset.tvTab;
      if (_tab === 'questions' && !Q) { try { Q = await H.api(`${BASE}/questions`); } catch (e) { H.fail(e); } }
      paint();
    }));
    bind();
  }

  /* ── Today ────────────────────────────────────────────────────── */

  function heroHtml() {
    const wrap = (inner, tone = 'linear-gradient(135deg,#1e3a8a,#4338ca 55%,#7c3aed)') =>
      `<div style="border-radius:18px;padding:24px 26px;color:#fff;background:${tone};margin-bottom:18px;box-shadow:0 12px 30px rgba(67,56,202,.25);">${inner}</div>`;
    if (T.state === 'none') return wrap(`<div style="font-size:16px;font-weight:700;">No question today</div>
      <div style="opacity:.8;font-size:13px;margin-top:4px;">${T.manage ? 'Add some questions in the Questions tab.' : 'Check back tomorrow.'}</div>`);
    if (T.state === 'new' || T.state === 'playing') {
      return wrap(`<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <div style="font-size:46px;line-height:1;">🧠</div>
        <div style="flex:1;min-width:220px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.75;">Today's question · ${esc(T.category || 'General')}</div>
          <div style="font-size:20px;font-weight:800;margin-top:4px;">${T.state === 'playing' ? 'Your clock is running!' : `${T.limitSec} seconds. One try. Ready?`}</div>
          <div style="font-size:12.5px;opacity:.8;margin-top:4px;">Right answer = 50 points + 5 for every second left. The timer starts when you press Start.</div>
        </div>
        <button type="button" id="tv-play" style="border:none;border-radius:12px;padding:13px 26px;font-size:15px;font-weight:800;cursor:pointer;background:#facc15;color:#1e1b4b;box-shadow:0 6px 0 #ca8a04;">
          ${T.state === 'playing' ? '▶ Resume' : '▶ Play'}</button>
      </div>`);
    }
    const r = T.result;
    const tone = r.correct ? 'linear-gradient(135deg,#047857,#059669 55%,#10b981)' : 'linear-gradient(135deg,#7f1d1d,#b91c1c 55%,#ef4444)';
    const mine = r.choice >= 0 ? r.options[r.choice] : null;
    return wrap(`<div style="display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap;">
      <div style="text-align:center;min-width:90px;">
        <div style="font-size:40px;font-weight:900;line-height:1;">${r.points}</div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.8;">points</div>
      </div>
      <div style="flex:1;min-width:240px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.75;">
          ${r.correct ? `✓ Correct in ${secs(r.ms_taken)}` : r.choice < 0 ? '⏱ Time up' : '✗ Not this time'} · ${esc(r.category || '')}</div>
        <div style="font-size:16px;font-weight:700;margin-top:6px;">${esc(r.question)}</div>
        <div style="font-size:13px;margin-top:8px;">Answer: <b>${esc(r.options[r.answer_idx])}</b>${!r.correct && mine ? ` · you said ${esc(mine)}` : ''}</div>
        ${r.fact ? `<div style="font-size:12.5px;opacity:.85;margin-top:6px;">💡 ${esc(r.fact)}</div>` : ''}
        <div style="font-size:12px;opacity:.75;margin-top:10px;">Next question tomorrow.</div>
      </div>
    </div>`, tone);
  }

  function rankTable(rows, { month = false } = {}) {
    if (!rows.length) return H.empty(month ? 'Nobody has played this month yet' : 'Nobody has played today yet', 'Be the first!');
    const me = String(window.currentUser?.id ?? '');
    const cols = month
      ? ['#', { label: 'Name', m: 'title' }, 'Department', { label: 'Points', align: 'right' }, { label: 'Right', align: 'right' }, { label: 'Streak', align: 'right' }]
      : ['#', { label: 'Name', m: 'title' }, 'Department', { label: 'Points', align: 'right' }, { label: 'Time', align: 'right' }, { label: 'Streak', align: 'right' }];
    return H.table(cols, rows.map((u, i) => {
      const you = u.user_id === me;
      const name = `<b style="${you ? 'color:var(--color-primary);' : ''}">${esc(u.name)}${you ? ' (you)' : ''}</b>`;
      const streak = u.streak >= 2 ? `🔥 ${u.streak}` : u.streak || '—';
      return month
        ? [medal(i), name, esc(u.department || '—'), `<b>${u.points}</b>`, `${u.correct}/${u.played}`, streak]
        : [medal(i), name, esc(u.department || '—'), `<b>${u.points}</b>`, u.correct ? secs(u.ms) : (u.points ? '' : '✗'), streak];
    }), { cards: true });
  }

  function todayHtml() {
    const s = B.todayStats;
    return heroHtml()
      + H.stats([
        { label: 'Played today', value: String(s.played) },
        { label: 'Got it right', value: String(s.correct), color: '#059669' },
        { label: 'Top score', value: String(B.today[0]?.points ?? 0), hint: B.today[0]?.name || '' },
      ])
      + sec(`Today · ${fmtDay(B.day)}`)
      + rankTable(B.today);
  }

  /* ── Leaderboard ──────────────────────────────────────────────── */

  function boardHtml() {
    const month = new Date(B.day + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const depts = B.departments.length
      ? H.table(['#', { label: 'Department', m: 'title' }, { label: 'Avg / play', align: 'right' }, { label: 'Players', align: 'right' }, { label: 'Total', align: 'right' }],
        B.departments.map((d, i) => [medal(i), `<b>${esc(d.department)}</b>`, `<b>${d.avg}</b>`, d.players, d.points]), { cards: true })
      : H.empty('No departments yet');
    return sec(`This month · ${month}`) + rankTable(B.month, { month: true })
      + `<div style="height:14px;"></div>` + sec('Departments (average points per play, so big teams don\'t win just by size)') + depts;
  }

  /* ── Questions (Admin/HOD) ────────────────────────────────────── */

  function questionsHtml() {
    if (!Q) return H.spinner();
    const cats = ['All', ...new Set(Q.questions.map((m) => m.category).filter(Boolean))].sort((a, b) => (a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b)));
    const needle = _qf.q.toLowerCase();
    const list = Q.questions.filter((m) => (_qf.cat === 'All' || m.category === _qf.cat)
      && (!needle || (m.question + ' ' + m.options.join(' ')).toLowerCase().includes(needle)));
    const fresh = Q.questions.filter((m) => m.active && !m.times_used).length;
    const plays = Q.plays.length
      ? H.table([{ label: 'Name', m: 'title' }, 'Department', { label: 'Points', align: 'right' }, { label: 'Time', align: 'right' }, { label: '', m: 'actions' }],
        Q.plays.map((p) => [esc(p.name), esc(p.department || '—'), p.answered ? String(p.points) : 'playing…', p.answered ? secs(p.ms_taken) : '',
          `<button class="btn-secondary btn-sm" data-tv-reset="${p.id}" title="Let them play today's question again">Reset</button>`]), { cards: true })
      : H.empty('Nobody has played today yet');
    return H.stats([
      { label: 'Questions', value: String(Q.questions.filter((m) => m.active).length) },
      { label: 'Not used yet', value: String(fresh), hint: `≈ ${fresh} more days`, color: fresh < 10 ? '#dc2626' : undefined },
      { label: 'Scheduled', value: String(Q.questions.filter((m) => m.active && m.sched_date && m.sched_date >= B.day).length) },
    ])
      + `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">
          <input id="tv-qs" placeholder="Search questions…" value="${esc(_qf.q)}" style="${H.CONTROL}max-width:260px;" />
          <select id="tv-qc" style="${H.CONTROL}max-width:190px;">${cats.map((c) => `<option${c === _qf.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <span style="flex:1;"></span>
          <button class="btn-secondary" id="tv-import">Import CSV</button>
          <button class="btn-primary" id="tv-add">+ Add question</button>
        </div>`
      + H.table([{ label: 'Question', m: 'title' }, 'Answer', 'Category', 'Date', { label: '', m: 'actions' }], list.map((m) => {
        const tag = m.id === Q.todayId ? H.pill('Today', 'success')
          : !m.active ? H.pill('Off', 'neutral')
          : m.sched_date ? H.pill(fmtDay(m.sched_date), 'info')
          : m.used_on ? `<span style="color:#94a3b8;font-size:11.5px;">used ${esc(fmtDay(m.used_on))}</span>` : '';
        return [`<div style="max-width:420px;white-space:normal;${m.active ? '' : 'opacity:.55;'}">${esc(m.question)}</div>`,
          esc(m.options[m.answer_idx] || ''), esc(m.category), tag,
          `<div style="display:flex;gap:6px;justify-content:flex-end;">
             <button class="btn-secondary btn-sm" data-tv-edit="${esc(m.id)}">Edit</button>
             <button class="btn-secondary btn-sm" data-tv-del="${esc(m.id)}" style="color:#b91c1c;">${m.times_used ? 'Switch off' : 'Delete'}</button>
           </div>`];
      }), { empty: 'No questions match', maxHeight: '520px', cards: true })
      + `<div style="height:14px;"></div>` + sec('Today\'s plays') + plays;
  }

  function editQuestion(m) {
    const o = m ? m.options : ['', '', '', ''];
    while (o.length < 4) o.push('');
    const cats = [...new Set(['General', 'India', 'Science', 'Metals & Kitchen', 'Export & Trade', 'Sports', 'Puzzle', ...Q.questions.map((x) => x.category)])].filter(Boolean);
    H.openModal({
      id: 'tv-q-modal', title: m ? 'Edit question' : 'New question', width: 600,
      subtitle: 'Tick the right answer. 2 to 4 options.',
      bodyHTML: `<div style="display:grid;gap:12px;">
        ${H.textarea('tv-q-text', 'Question', m?.question || '', { rows: 2 })}
        ${o.map((v, i) => `<div style="display:flex;gap:8px;align-items:center;">
          <input type="radio" name="tv-q-ans" value="${i}" ${m && m.answer_idx === i || (!m && i === 0) ? 'checked' : ''} style="width:18px;height:18px;flex-shrink:0;" title="Correct answer" />
          <input id="tv-q-o${i}" value="${esc(v)}" placeholder="Option ${LETTERS[i]}${i < 2 ? '' : ' (optional)'}" style="${H.CONTROL}" />
        </div>`).join('')}
        ${H.textarea('tv-q-fact', 'Fun fact shown after answering (optional)', m?.fact || '', { rows: 2 })}
        ${H.grid(H.select('tv-q-cat', 'Category', m?.category || 'General', cats)
          + H.field('tv-q-date', 'Show on date (optional)', m?.sched_date || '', { type: 'date', hint: 'Blank = picked at random' }))}
        <label style="display:flex;gap:8px;align-items:center;font-size:13px;"><input type="checkbox" id="tv-q-active" ${!m || m.active ? 'checked' : ''} /> Active (can be picked)</label>
      </div>`,
      onConfirm: async () => {
        const options = [0, 1, 2, 3].map((i) => H.val(`tv-q-o${i}`).trim());
        const ans = Number(document.querySelector('input[name="tv-q-ans"]:checked')?.value ?? -1);
        if (!options[ans]) throw new Error('The ticked answer is empty');
        // Drop empty options, keeping the tick on the same text.
        const kept = options.filter(Boolean);
        await H.post(`${BASE}/questions`, {
          id: m?.id || '', question: H.val('tv-q-text'), options: kept, answer_idx: kept.indexOf(options[ans]),
          fact: H.val('tv-q-fact'), category: H.val('tv-q-cat'), sched_date: H.val('tv-q-date'),
          active: document.getElementById('tv-q-active').checked,
        });
        H.closeModal('tv-q-modal');
        H.toast('Question saved');
        Q = await H.api(`${BASE}/questions`);
        paint();
      },
    });
  }

  function importCsv() {
    let rows = null;
    H.openModal({
      id: 'tv-imp-modal', title: 'Import questions', confirmText: 'Import', width: 600,
      subtitle: 'CSV columns: category, question, correct, wrong1, wrong2, wrong3, fact',
      bodyHTML: `<div style="font-size:12.5px;color:#475569;margin-bottom:10px;">One question per row, with a header row. The right answer goes in <b>correct</b>; the options get shuffled. Questions already in the bank are skipped.
        <a href="#" id="tv-imp-tpl" style="color:var(--color-primary);font-weight:600;">Download template</a></div>
        <input type="file" id="tv-imp-file" accept=".csv,text/csv" />
        <div id="tv-imp-out" style="margin-top:10px;font-size:12.5px;"></div>`,
      onOpen: () => {
        document.getElementById('tv-imp-tpl').onclick = (e) => {
          e.preventDefault();
          H.downloadCsv('trivia-questions.csv', ['category', 'question', 'correct', 'wrong1', 'wrong2', 'wrong3', 'fact'],
            [['General', 'Which is the largest ocean?', 'Pacific', 'Atlantic', 'Indian', 'Arctic', 'The Pacific is bigger than all the land on Earth.']]);
        };
        document.getElementById('tv-imp-file').onchange = async (e) => {
          const out = document.getElementById('tv-imp-out');
          try {
            const { header, rows: raw } = H.parseCsv(await e.target.files[0].text());
            const idx = (k) => header.findIndex((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '') === k);
            const cols = ['category', 'question', 'correct', 'wrong1', 'wrong2', 'wrong3', 'fact'].map((k) => [k, idx(k)]);
            if (idx('question') < 0 || idx('correct') < 0) throw new Error('Need at least the "question" and "correct" columns');
            rows = raw.filter((r) => r.some((c) => String(c).trim()))
              .map((r) => Object.fromEntries(cols.map(([k, i]) => [k, i >= 0 ? r[i] : ''])));
            out.innerHTML = `<b>${rows.length}</b> question${rows.length === 1 ? '' : 's'} found.`;
          } catch (err) { rows = null; out.innerHTML = `<span style="color:#b91c1c;">${esc(err.message)}</span>`; }
        };
      },
      onConfirm: async () => {
        if (!rows || !rows.length) throw new Error('Choose a CSV file first');
        const r = await H.post(`${BASE}/questions/import`, { rows });
        H.closeModal('tv-imp-modal');
        H.toast(`Imported ${r.saved}` + (r.errors.length ? ` — ${r.errors.length} skipped` : ''));
        if (r.errors.length) console.warn('[trivia import]', r.errors.join('\n'));
        Q = await H.api(`${BASE}/questions`);
        paint();
      },
    });
  }

  function bind() {
    document.getElementById('tv-play')?.addEventListener('click', () => play(refresh));
    if (_tab !== 'questions' || !Q) return;
    const qs = document.getElementById('tv-qs');
    qs?.addEventListener('input', () => {
      _qf.q = qs.value;
      clearTimeout(bind._t);
      bind._t = setTimeout(() => { paint(); const n = document.getElementById('tv-qs'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250);
    });
    document.getElementById('tv-qc')?.addEventListener('change', (e) => { _qf.cat = e.target.value; paint(); });
    document.getElementById('tv-add')?.addEventListener('click', () => editQuestion(null));
    document.getElementById('tv-import')?.addEventListener('click', importCsv);
    document.querySelectorAll('[data-tv-edit]').forEach((b) => b.addEventListener('click', () =>
      editQuestion(Q.questions.find((m) => m.id === b.dataset.tvEdit))));
    document.querySelectorAll('[data-tv-del]').forEach((b) => b.addEventListener('click', async () => {
      const m = Q.questions.find((x) => x.id === b.dataset.tvDel);
      if (!m || !window.confirm(m.times_used ? 'Switch this question off? It has been played, so it is kept for the old results.' : 'Delete this question?')) return;
      try { await H.del(`${BASE}/questions/${encodeURIComponent(m.id)}`); Q = await H.api(`${BASE}/questions`); paint(); } catch (e) { H.fail(e); }
    }));
    document.querySelectorAll('[data-tv-reset]').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm('Reset this play? They can then play today\'s question again.')) return;
      try { await H.del(`${BASE}/plays/${b.dataset.tvReset}`); await load(); paint(); H.toast('Play reset'); } catch (e) { H.fail(e); }
    }));
  }

  /* ── The game overlay ─────────────────────────────────────────── */

  const OV_ID = 'tv-overlay';
  let _timer = null;

  function closeOverlay() {
    clearInterval(_timer); _timer = null;
    document.getElementById(OV_ID)?.remove();
    document.removeEventListener('keydown', _keys);
  }
  let _keys = () => {};

  function overlayShell(inner) {
    document.getElementById(OV_ID)?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div id="${OV_ID}" style="position:fixed;inset:0;z-index:10000;background:radial-gradient(circle at 30% 20%,#312e81,#0f172a 70%);
           display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;font-family:inherit;">
        <style>
          @keyframes tvPop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.15);opacity:1}100%{transform:scale(1)}}
          @keyframes tvIn{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
          @keyframes tvShake{0%,100%{transform:none}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
          #${OV_ID} .tv-opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:2px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);
            color:#fff;border-radius:14px;padding:15px 16px;font-size:16px;font-weight:600;cursor:pointer;transition:transform .12s,background .12s,border-color .12s;font-family:inherit;}
          #${OV_ID} .tv-opt:hover:not(:disabled){background:rgba(255,255,255,.15);border-color:#facc15;transform:translateY(-2px);}
          #${OV_ID} .tv-opt:disabled{cursor:default;}
          #${OV_ID} .tv-opt b{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:rgba(255,255,255,.15);flex-shrink:0;font-size:14px;}
          #${OV_ID} .tv-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
          @media (max-width:640px){#${OV_ID} .tv-grid{grid-template-columns:1fr;} #${OV_ID} .tv-q{font-size:19px !important;}}
        </style>
        <div style="width:100%;max-width:760px;color:#fff;position:relative;animation:tvIn .25s ease-out;">
          <button id="tv-ov-x" aria-label="Close" style="position:absolute;top:-6px;right:0;border:none;background:rgba(255,255,255,.12);color:#fff;width:34px;height:34px;border-radius:10px;cursor:pointer;font-size:18px;">✕</button>
          <div id="tv-ov-body">${inner}</div>
        </div>
      </div>`);
    document.getElementById('tv-ov-x').onclick = () => { closeOverlay(); _onClose(); };
  }
  let _onClose = () => {};

  // The intro first, so the clock never starts by surprise.
  async function play(onClose) {
    _onClose = typeof onClose === 'function' ? onClose : () => {};
    let t;
    try { t = await H.api(`${BASE}/today`); } catch (e) { H.fail(e); return; }
    if (t.state === 'none') { H.toast('No trivia question today', 'error'); return; }
    if (t.state === 'done') { showResult(t.result, false); return; }
    if (t.state === 'playing') { ask(t); return; }
    overlayShell(`<div style="text-align:center;padding:30px 10px;">
      <div style="font-size:64px;">🧠</div>
      <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#a5b4fc;margin-top:8px;">Daily Trivia · ${esc(t.category || 'General')}</div>
      <div style="font-size:28px;font-weight:900;margin-top:8px;">${t.limitSec} seconds. One try.</div>
      <div style="font-size:14px;color:#c7d2fe;margin-top:10px;line-height:1.6;">Right answer = <b>50 points</b> + <b>5 for every second left</b>.<br>Wrong or out of time = 0. The faster you are, the higher you go on the big screen.</div>
      <button id="tv-go" style="margin-top:26px;border:none;border-radius:14px;padding:16px 46px;font-size:18px;font-weight:900;cursor:pointer;background:#facc15;color:#1e1b4b;box-shadow:0 7px 0 #ca8a04;">START ▶</button>
      <div style="font-size:12px;color:#818cf8;margin-top:16px;">Keys 1–4 or A–D also answer.</div>
    </div>`);
    const go = document.getElementById('tv-go');
    go.focus();
    go.onclick = async () => {
      go.disabled = true; go.textContent = '…';
      try {
        const s = await H.post(`${BASE}/start`);
        if (s.state === 'done') showResult(s.result, false); else ask(s);
      } catch (e) { H.fail(e); go.disabled = false; go.textContent = 'START ▶'; }
    };
  }

  function ask(s) {
    const total = (T?.limitSec || 30) * 1000;
    const R = 30, C = 2 * Math.PI * R;
    overlayShell(`
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:22px;padding-right:44px;">
        <div style="position:relative;width:76px;height:76px;flex-shrink:0;">
          <svg width="76" height="76" viewBox="0 0 76 76" style="transform:rotate(-90deg);">
            <circle cx="38" cy="38" r="${R}" stroke="rgba(255,255,255,.12)" stroke-width="7" fill="none"/>
            <circle id="tv-ring" cx="38" cy="38" r="${R}" stroke="#facc15" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0" style="transition:stroke-dashoffset .1s linear,stroke .3s;"/>
          </svg>
          <div id="tv-secs" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:900;">30</div>
        </div>
        <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#a5b4fc;">Daily Trivia · ${esc(s.category || 'General')}</div>
      </div>
      <div class="tv-q" style="font-size:24px;font-weight:800;line-height:1.35;margin-bottom:22px;">${esc(s.question)}</div>
      <div class="tv-grid">${s.options.map((o, i) => `<button class="tv-opt" data-i="${i}"><b>${LETTERS[i]}</b><span>${esc(o)}</span></button>`).join('')}</div>`);

    const deadline = Date.now() + s.remainingMs;
    let sent = false;
    const send = async (choice) => {
      if (sent) return;
      sent = true;
      clearInterval(_timer);
      document.querySelectorAll(`#${OV_ID} .tv-opt`).forEach((b) => { b.disabled = true; if (+b.dataset.i === choice) b.style.borderColor = '#facc15'; });
      try {
        const r = await H.post(`${BASE}/answer`, { choice });
        showResult(r.result, true);
      } catch (e) { H.fail(e); closeOverlay(); _onClose(); }
    };
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      const ring = document.getElementById('tv-ring');
      if (!ring) { clearInterval(_timer); return; }
      ring.style.strokeDashoffset = String(C * (1 - left / total));
      ring.style.stroke = left < 5000 ? '#ef4444' : left < 10000 ? '#fb923c' : '#facc15';
      document.getElementById('tv-secs').textContent = String(Math.ceil(left / 1000));
      if (left <= 0) send(-1);
    };
    clearInterval(_timer);
    _timer = setInterval(tick, 100);
    tick();
    document.querySelectorAll(`#${OV_ID} .tv-opt`).forEach((b) => b.addEventListener('click', () => send(+b.dataset.i)));
    document.removeEventListener('keydown', _keys);
    _keys = (e) => {
      const k = e.key.toUpperCase();
      const i = '1234'.includes(k) ? +k - 1 : LETTERS.indexOf(k);
      if (i >= 0 && i < s.options.length) send(i);
    };
    document.addEventListener('keydown', _keys);
  }

  function showResult(r, fresh) {
    document.removeEventListener('keydown', _keys);
    const head = r.correct ? `🎉 Correct! ${secs(r.ms_taken)}` : r.choice < 0 ? '⏱ Time up!' : '😅 Not this time';
    overlayShell(`
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:15px;font-weight:800;color:${r.correct ? '#4ade80' : '#fca5a5'};">${head}</div>
        <div style="font-size:72px;font-weight:900;line-height:1.05;margin-top:4px;${fresh ? 'animation:tvPop .55s ease-out;' : ''}color:${r.correct ? '#facc15' : '#fff'};">${r.points}</div>
        <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#a5b4fc;">points today</div>
      </div>
      <div class="tv-q" style="font-size:19px;font-weight:700;line-height:1.35;margin-bottom:16px;">${esc(r.question)}</div>
      <div class="tv-grid" style="${!r.correct && fresh ? 'animation:tvShake .35s;' : ''}">${r.options.map((o, i) => {
        const right = i === r.answer_idx, mine = i === r.choice;
        const st = right ? 'background:rgba(34,197,94,.25);border-color:#22c55e;' : mine ? 'background:rgba(239,68,68,.25);border-color:#ef4444;' : 'opacity:.55;';
        return `<button class="tv-opt" disabled style="${st}"><b>${right ? '✓' : mine ? '✗' : LETTERS[i]}</b><span>${esc(o)}</span></button>`;
      }).join('')}</div>
      ${r.fact ? `<div style="margin-top:16px;padding:13px 15px;border-radius:12px;background:rgba(255,255,255,.08);font-size:14px;color:#e0e7ff;">💡 ${esc(r.fact)}</div>` : ''}
      <div style="display:flex;gap:10px;justify-content:center;margin-top:22px;flex-wrap:wrap;">
        <button id="tv-ov-board" style="border:none;border-radius:12px;padding:12px 24px;font-size:15px;font-weight:800;cursor:pointer;background:#facc15;color:#1e1b4b;">See leaderboard</button>
        <button id="tv-ov-done" style="border:2px solid rgba(255,255,255,.25);border-radius:12px;padding:12px 24px;font-size:15px;font-weight:700;cursor:pointer;background:none;color:#fff;">Close</button>
      </div>
      <div style="text-align:center;font-size:12px;color:#818cf8;margin-top:14px;">Next question tomorrow.</div>`);
    document.getElementById('tv-ov-done').onclick = () => { closeOverlay(); _onClose(); };
    document.getElementById('tv-ov-board').onclick = () => {
      closeOverlay();
      _tab = 'today';
      if ((window.location.hash || '').replace('#', '') === 'trivia') refresh(); else Router.navigate('trivia');
    };
  }

  return { render, play };
})();
