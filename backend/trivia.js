'use strict';
/* =====================================================================
   Daily Trivia — one 30-second question a day, for everyone, just for fun.
   ---------------------------------------------------------------------
   "Din mein sirf ek hi aana chahiye, aur uska scoring bade screen pe flash
   hona chahiye." So:

     - one question per IST day, the same for everybody (trivia_days pins
       it the first time anyone asks for today);
     - one attempt per person per day (UNIQUE day + user_id);
     - the 30 seconds are timed on the server: the question text is only
       sent by POST /start, which stamps started_at; POST /answer works out
       the time from that stamp, so a refresh, a slow phone or a peek at the
       network tab gains nothing. A play started and never answered turns
       into a time-out once its 30 s (plus a little grace) are over;
     - points: correct = 50 + 5 per whole second left (max 200), wrong or
       timed out = 0;
     - /trivia-screen (public/trivia-screen.html) is the big-screen board:
       today's ranking, this month's, departments, and a full-screen flash
       for each new score. It polls GET /board.

   Which question: one scheduled for that date if there is one, else a
   random active question not used yet; once all are used, the one used
   longest ago. The bank starts with the SEED list below (first run only);
   Admin/HOD add, edit, schedule and import questions on the page.

   Today's question and answer are only shown on the board after
   REVEAL_HOUR IST, so the screen does not give it away to people who
   have not played yet.

   Access: every logged-in user plays (sidebar alwaysShow). Questions and
   resetting a play need Admin/HOD. Works in local JSON mode too
   (database/trivia.json).
   ===================================================================== */

const fsp = require('fs').promises;
const path = require('path');

const JSON_FILE = path.join(__dirname, '..', 'database', 'trivia.json');
const LIMIT_MS = 30000;
const GRACE_MS = 2500;      // network round trip on a slow phone
const REVEAL_HOUR = 18;     // IST hour after which the board shows today's answer

const TRIVIA_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS trivia_questions (
     id VARCHAR(16) PRIMARY KEY,
     question TEXT NOT NULL,
     options TEXT NOT NULL,
     answer_idx INT NOT NULL DEFAULT 0,
     fact TEXT,
     category VARCHAR(64) DEFAULT '',
     sched_date DATE NULL,
     used_on DATE NULL,
     active TINYINT NOT NULL DEFAULT 1,
     created_by VARCHAR(255) DEFAULT '',
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS trivia_days (
     day DATE PRIMARY KEY,
     question_id VARCHAR(16) NOT NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS trivia_plays (
     id INT AUTO_INCREMENT PRIMARY KEY,
     day DATE NOT NULL,
     user_id VARCHAR(64) NOT NULL,
     user_name VARCHAR(255) DEFAULT '',
     department VARCHAR(128) DEFAULT '',
     question_id VARCHAR(16) NOT NULL,
     started_at BIGINT NOT NULL,
     answered_at BIGINT NULL,
     choice INT NULL,
     correct TINYINT NOT NULL DEFAULT 0,
     ms_taken INT NULL,
     points INT NOT NULL DEFAULT 0,
     UNIQUE KEY uq_trivia_day_user (day, user_id),
     KEY idx_trivia_day (day)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

/* The starting bank — [category, question, correct, wrong, wrong, wrong, fact].
   Options are shuffled once when seeded. */
const SEED = [
  ['Metals & Kitchen', 'Which is the most abundant metal in the Earth\'s crust?', 'Aluminium', 'Iron', 'Copper', 'Gold', 'Aluminium makes up about 8% of the Earth\'s crust by weight.'],
  ['Metals & Kitchen', 'Aluminium is mainly made from which ore?', 'Bauxite', 'Haematite', 'Galena', 'Cinnabar', 'Haematite is iron ore, galena is lead ore and cinnabar is mercury ore.'],
  ['Metals & Kitchen', 'What is the chemical symbol of aluminium?', 'Al', 'Am', 'Au', 'Ag', 'Au is gold and Ag is silver (from the Latin aurum and argentum).'],
  ['Metals & Kitchen', 'Aluminium melts at roughly what temperature?', '660 °C', '330 °C', '1085 °C', '1538 °C', '1085 °C is copper and 1538 °C is iron.'],
  ['Metals & Kitchen', 'Stainless steel resists rust mainly because it contains…', 'Chromium', 'Copper', 'Lead', 'Tin', 'At least about 10.5% chromium forms a thin invisible oxide layer that protects the steel.'],
  ['Metals & Kitchen', 'Recycling aluminium saves about how much of the energy needed to make it new?', 'About 95%', 'About 25%', 'About 50%', 'About 10%', 'That is why aluminium is one of the most recycled materials in the world.'],
  ['Metals & Kitchen', 'Brass is an alloy of copper and…', 'Zinc', 'Tin', 'Nickel', 'Lead', 'Copper + tin makes bronze.'],
  ['Metals & Kitchen', 'Galvanised iron is coated with which metal?', 'Zinc', 'Tin', 'Chromium', 'Aluminium', 'The zinc corrodes first and so protects the iron underneath.'],
  ['Metals & Kitchen', 'Anodising is a finish most commonly given to which metal?', 'Aluminium', 'Copper', 'Iron', 'Lead', 'Anodising thickens aluminium\'s natural oxide layer, making it harder and able to take colour.'],
  ['Metals & Kitchen', 'An induction cooktop only works with cookware that is…', 'Magnetic', 'Shiny', 'Heavy', 'Non-stick', 'Plain aluminium is not magnetic, so induction-ready aluminium pans get a steel base.'],
  ['Metals & Kitchen', 'Which metal is liquid at room temperature?', 'Mercury', 'Sodium', 'Gallium', 'Tin', 'Gallium melts at about 30 °C — it will melt in your hand, but not on the shelf.'],
  ['Metals & Kitchen', 'A pressure cooker cooks food faster because…', 'Water boils at a higher temperature inside', 'The steam is cooler', 'The food gets lighter', 'Air is removed completely', 'At higher pressure water boils above 100 °C — around 120 °C in a pressure cooker.'],
  ['Metals & Kitchen', 'Which country produces the most aluminium in the world?', 'China', 'India', 'Russia', 'Canada', 'China makes more than half of the world\'s primary aluminium. India is second.'],
  ['Metals & Kitchen', 'Which element has the symbol Fe?', 'Iron', 'Fluorine', 'Fermium', 'Lead', 'Fe comes from the Latin word "ferrum". Lead is Pb.'],
  ['Export & Trade', 'In shipping terms, what does FOB stand for?', 'Free On Board', 'Freight On Bill', 'Free Of Billing', 'Final Order Booking', 'Under FOB the seller\'s risk ends once the goods are loaded on the vessel.'],
  ['Export & Trade', 'In container shipping, what does TEU stand for?', 'Twenty-foot Equivalent Unit', 'Total Export Unit', 'Transport Equipment Unit', 'Ton Equivalent Unit', 'A 40-foot container counts as 2 TEU.'],
  ['Export & Trade', 'Mundra Port is in which state?', 'Gujarat', 'Maharashtra', 'Kerala', 'Odisha', 'Mundra in Kutch is India\'s largest commercial port.'],
  ['Export & Trade', 'Nhava Sheva (JNPA) port is near which city?', 'Mumbai', 'Chennai', 'Kolkata', 'Kochi', 'It is India\'s busiest container port, across the harbour from Mumbai.'],
  ['Export & Trade', 'What does GST stand for?', 'Goods and Services Tax', 'General Sales Tax', 'Government Service Tax', 'Gross Sales Turnover', 'GST came into force in India on 1 July 2017.'],
  ['Export & Trade', 'What is the currency of Japan?', 'Yen', 'Won', 'Yuan', 'Ringgit', 'Won is Korea\'s, yuan is China\'s and ringgit is Malaysia\'s.'],
  ['Export & Trade', 'What is the currency of the United Arab Emirates?', 'Dirham', 'Riyal', 'Dinar', 'Lira', 'Riyal is Saudi Arabia\'s and Qatar\'s; dinar is Kuwait\'s.'],
  ['Export & Trade', 'In "CIF" pricing, the I stands for…', 'Insurance', 'Invoice', 'Interest', 'Import', 'CIF = Cost, Insurance and Freight — the seller pays all three to the destination port.'],
  ['India', 'Which is the national aquatic animal of India?', 'Gangetic dolphin', 'Blue whale', 'Olive ridley turtle', 'Mahseer', 'It was declared the national aquatic animal in 2009. It is nearly blind and finds food by echo.'],
  ['India', 'Who wrote "Jana Gana Mana"?', 'Rabindranath Tagore', 'Bankim Chandra Chatterjee', 'Sarojini Naidu', 'Muhammad Iqbal', 'Bankim Chandra wrote "Vande Mataram"; Iqbal wrote "Saare Jahan Se Achha".'],
  ['India', 'Which is the smallest state of India by area?', 'Goa', 'Sikkim', 'Tripura', 'Kerala', 'Goa is about 3,700 sq km. Sikkim is the second smallest.'],
  ['India', 'What is the capital of Gujarat?', 'Gandhinagar', 'Ahmedabad', 'Surat', 'Vadodara', 'Gandhinagar became the capital in 1970; before that it was Ahmedabad.'],
  ['India', 'The Statue of Unity is a statue of…', 'Sardar Vallabhbhai Patel', 'Mahatma Gandhi', 'B. R. Ambedkar', 'Subhas Chandra Bose', 'At 182 m it is the tallest statue in the world, at Kevadia in Gujarat.'],
  ['India', 'How many states does India have?', '28', '29', '27', '30', 'Plus 8 Union Territories.'],
  ['India', 'Which city is called the "Pink City"?', 'Jaipur', 'Jodhpur', 'Udaipur', 'Bhopal', 'Jodhpur is the Blue City and Udaipur the City of Lakes.'],
  ['India', 'Which Mughal emperor built the Red Fort in Delhi?', 'Shah Jahan', 'Akbar', 'Aurangzeb', 'Humayun', 'Shah Jahan also built the Taj Mahal.'],
  ['India', 'Who is called the "Missile Man of India"?', 'A. P. J. Abdul Kalam', 'Vikram Sarabhai', 'Homi Bhabha', 'C. V. Raman', 'He was President of India from 2002 to 2007.'],
  ['India', 'Chandrayaan-3 landed near which part of the Moon?', 'South pole', 'North pole', 'Equator', 'Far side', 'It landed on 23 August 2023 — that date is now National Space Day.'],
  ['India', 'Which is the national bird of India?', 'Peacock', 'Parrot', 'Eagle', 'Swan', 'The Indian peafowl was declared the national bird in 1963.'],
  ['India', 'Which country has had the largest population since 2023?', 'India', 'China', 'USA', 'Indonesia', 'UN estimates show India passing China in April 2023.'],
  ['India', 'How many zeros are there in one crore?', '7', '6', '8', '5', '1 crore = 1,00,00,000 = 10 million.'],
  ['India', 'The Taj Mahal is in which city?', 'Agra', 'Delhi', 'Lucknow', 'Jaipur', 'It stands on the bank of the Yamuna.'],
  ['Science', 'Which planet is known as the Red Planet?', 'Mars', 'Venus', 'Jupiter', 'Mercury', 'Iron oxide (rust) in its soil makes it look red.'],
  ['Science', 'How many bones does an adult human have?', '206', '212', '196', '300', 'A newborn has about 300; many fuse together as we grow.'],
  ['Science', 'Which gas do plants take in from the air?', 'Carbon dioxide', 'Oxygen', 'Nitrogen', 'Hydrogen', 'They use it with sunlight and water to make food, giving out oxygen.'],
  ['Science', 'Which is the hardest natural substance?', 'Diamond', 'Quartz', 'Granite', 'Iron', 'Diamond is pure carbon — like the graphite in a pencil.'],
  ['Science', 'Light travels at about how many km per second?', '3 lakh', '30 thousand', '3 crore', '3 thousand', 'Sunlight takes about 8 minutes to reach the Earth.'],
  ['Science', 'Our skin makes which vitamin in sunlight?', 'Vitamin D', 'Vitamin C', 'Vitamin A', 'Vitamin B12', 'Vitamin D helps the body absorb calcium for strong bones.'],
  ['Science', 'Which is the largest planet in our solar system?', 'Jupiter', 'Saturn', 'Neptune', 'Earth', 'More than 1,300 Earths could fit inside Jupiter.'],
  ['Science', 'Water boils at what temperature in Fahrenheit (at sea level)?', '212 °F', '100 °F', '180 °F', '32 °F', '32 °F is where water freezes.'],
  ['Science', 'Which blood group is the universal donor?', 'O negative', 'AB positive', 'A positive', 'B negative', 'AB positive is the universal receiver.'],
  ['Science', 'Which organ filters waste out of the blood?', 'Kidney', 'Lungs', 'Heart', 'Stomach', 'The two kidneys filter about 180 litres of blood a day.'],
  ['Science', 'Who invented the telephone?', 'Alexander Graham Bell', 'Thomas Edison', 'Nikola Tesla', 'Guglielmo Marconi', 'Bell got the patent in 1876. Marconi is known for radio.'],
  ['General', 'Which is the largest ocean?', 'Pacific', 'Atlantic', 'Indian', 'Arctic', 'The Pacific is bigger than all the land on Earth put together.'],
  ['General', 'What is the capital of Australia?', 'Canberra', 'Sydney', 'Melbourne', 'Perth', 'Canberra was built as a compromise between Sydney and Melbourne.'],
  ['General', 'Which is the fastest land animal?', 'Cheetah', 'Lion', 'Horse', 'Leopard', 'A cheetah can touch about 100 km/h in short bursts.'],
  ['General', 'Which is the largest hot desert in the world?', 'Sahara', 'Thar', 'Gobi', 'Kalahari', 'Antarctica is the largest desert of all — a cold one.'],
  ['General', 'Which country gifted the Statue of Liberty to the USA?', 'France', 'United Kingdom', 'Spain', 'Italy', 'It was a gift for the USA\'s 100th birthday, in 1886.'],
  ['General', 'Which is the largest continent?', 'Asia', 'Africa', 'North America', 'Europe', 'Asia holds about 60% of the world\'s people.'],
  ['General', 'Who was the first person to walk on the Moon?', 'Neil Armstrong', 'Buzz Aldrin', 'Yuri Gagarin', 'Rakesh Sharma', 'July 1969, Apollo 11. Gagarin was the first person in space.'],
  ['General', 'Which is the highest mountain in the world?', 'Mount Everest', 'K2', 'Kangchenjunga', 'Makalu', 'Everest is 8,849 m. K2 is second and Kangchenjunga third.'],
  ['General', 'How many minutes are there in a day?', '1,440', '1,200', '3,600', '2,400', '24 hours × 60 minutes.'],
  ['General', 'How many days are there in a leap year?', '366', '365', '364', '367', 'The extra day is 29 February.'],
  ['Sports', 'In which year did India first win the Cricket World Cup?', '1983', '1987', '2011', '1975', 'Kapil Dev\'s team beat West Indies at Lord\'s.'],
  ['Sports', 'Which cricketer scored 100 international centuries?', 'Sachin Tendulkar', 'Virat Kohli', 'Ricky Ponting', 'Brian Lara', '51 in Tests and 49 in ODIs.'],
  ['Sports', 'How many players does a football team have on the field?', '11', '10', '9', '12', 'Including the goalkeeper.'],
  ['Sports', 'How many players does a kabaddi team have on the court?', '7', '6', '9', '11', 'A team has 7 on court and up to 5 substitutes.'],
  ['Puzzle', '5 machines make 5 utensils in 5 minutes. How long do 100 machines take to make 100 utensils?', '5 minutes', '100 minutes', '20 minutes', '1 minute', 'Each machine makes one utensil in 5 minutes, however many machines there are.'],
  ['Puzzle', 'What comes next: 2, 6, 12, 20, 30, ?', '42', '40', '36', '44', 'The gaps go 4, 6, 8, 10, 12 — or n × (n+1).'],
  ['Puzzle', 'A bat and a ball cost ₹110. The bat costs ₹100 more than the ball. What does the ball cost?', '₹5', '₹10', '₹1', '₹15', 'Ball ₹5 + bat ₹105 = ₹110.'],
  ['Puzzle', 'How many sides does a hexagon have?', '6', '5', '7', '8', 'Pentagon 5, heptagon 7, octagon 8.'],
  ['Puzzle', 'If today is Monday, what day will it be 100 days from now?', 'Wednesday', 'Tuesday', 'Monday', 'Friday', '100 = 14 weeks + 2 days, so two days after Monday.'],
  ['Puzzle', 'A clock shows 3:15. What is the angle between the hour and minute hands?', '7.5°', '0°', '15°', '30°', 'The hour hand has moved a quarter of the way from 3 to 4 — a quarter of 30°.'],
];

class UserError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const bad = (msg, status) => { throw new UserError(msg, status); };
const str = (v, max = 255) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const dOut = (v) => (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : (v ? String(v).slice(0, 10) : ''));
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// Small seeded shuffle so the seed bank's answers are not always option A,
// yet stay put from one restart to the next.
function shuffleSeeded(arr, seed) {
  const a = arr.slice();
  let s = seed >>> 0;
  const rnd = () => {   // mulberry32
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function seedQuestions() {
  return SEED.map(([category, question, right, ...rest], i) => {
    const fact = rest.pop();
    const options = shuffleSeeded([right, ...rest], i + 7);
    return {
      id: 'TQ' + String(i + 1).padStart(4, '0'), question, options, answer_idx: options.indexOf(right),
      fact, category, sched_date: '', used_on: '', active: 1, created_by: 'seed',
    };
  });
}

function cleanQuestion(src) {
  const question = str(src.question, 500);
  const options = (Array.isArray(src.options) ? src.options : []).map((o) => str(o, 160)).filter(Boolean);
  const answer_idx = Number(src.answer_idx);
  if (!question) bad('Write the question');
  if (options.length < 2 || options.length > 4) bad('Give 2 to 4 options');
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) bad('Two options are the same');
  if (!Number.isInteger(answer_idx) || answer_idx < 0 || answer_idx >= options.length) bad('Pick the correct option');
  return {
    question, options, answer_idx,
    fact: str(src.fact, 500),
    category: str(src.category, 64) || 'General',
    sched_date: isoDate(src.sched_date),
    active: src.active === false || src.active === 0 || src.active === '0' ? 0 : 1,
  };
}

// Points for a correct answer: 50 for being right + 5 per whole second left.
const pointsFor = (correct, ms) => (correct ? 50 + 5 * Math.max(0, Math.floor((LIMIT_MS - ms) / 1000)) : 0);

/* ===================================================================== */

function mountTrivia(app, ctx) {
  const { q, ensureSchema, requireAuth, isAdminUser, isSuperAdmin, istToday, useDb } = ctx;
  const BASE = '/api/trivia';
  const canManage = (u) => isSuperAdmin(u) || isAdminUser(u);

  /* ── Storage: tables in the DB, one JSON file in local JSON mode ── */

  async function readFile() {
    try {
      const d = JSON.parse(await fsp.readFile(JSON_FILE, 'utf8'));
      return { questions: d.questions || [], days: d.days || {}, plays: d.plays || [] };
    } catch { return { questions: [], days: {}, plays: [] }; }
  }
  async function writeFile(d) {
    await fsp.mkdir(path.dirname(JSON_FILE), { recursive: true });
    await fsp.writeFile(JSON_FILE, JSON.stringify(d, null, 1));
  }
  const qOut = (r) => ({
    id: r.id, question: r.question, options: parse(r.options, []), answer_idx: Number(r.answer_idx),
    fact: r.fact || '', category: r.category || '', sched_date: dOut(r.sched_date), used_on: dOut(r.used_on),
    active: Number(r.active) ? 1 : 0, created_by: r.created_by || '',
  });
  const pOut = (r) => ({
    id: Number(r.id), day: dOut(r.day), user_id: String(r.user_id), user_name: r.user_name || '', department: r.department || '',
    question_id: r.question_id, started_at: Number(r.started_at), answered_at: r.answered_at == null ? null : Number(r.answered_at),
    choice: r.choice == null ? null : Number(r.choice), correct: Number(r.correct) ? 1 : 0,
    ms_taken: r.ms_taken == null ? null : Number(r.ms_taken), points: Number(r.points) || 0,
  });

  const store = {
    async questions() {
      if (!useDb) return (await readFile()).questions;
      return (await q('SELECT * FROM trivia_questions ORDER BY id')).map(qOut);
    },
    async question(id) {
      if (!useDb) return (await readFile()).questions.find((x) => x.id === id) || null;
      const rows = await q('SELECT * FROM trivia_questions WHERE id = $1', [id]);
      return rows[0] ? qOut(rows[0]) : null;
    },
    async saveQuestion(m) {
      if (!useDb) {
        const d = await readFile();
        const i = d.questions.findIndex((x) => x.id === m.id);
        if (i >= 0) d.questions[i] = { ...d.questions[i], ...m }; else d.questions.push(m);
        return writeFile(d);
      }
      const ex = await q('SELECT id FROM trivia_questions WHERE id = $1', [m.id]);
      const vals = [m.question, JSON.stringify(m.options), m.answer_idx, m.fact, m.category, m.sched_date || null, m.active];
      if (ex.length) {
        await q('UPDATE trivia_questions SET question=$1, options=$2, answer_idx=$3, fact=$4, category=$5, sched_date=$6, active=$7 WHERE id=$8', [...vals, m.id]);
      } else {
        await q('INSERT INTO trivia_questions (question, options, answer_idx, fact, category, sched_date, active, id, created_by, used_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [...vals, m.id, m.created_by || '', m.used_on || null]);
      }
    },
    async deleteQuestion(id) {
      if (!useDb) { const d = await readFile(); d.questions = d.questions.filter((x) => x.id !== id); return writeFile(d); }
      await q('DELETE FROM trivia_questions WHERE id = $1', [id]);
    },
    async markUsed(id, day) {
      if (!useDb) {
        const d = await readFile();
        const x = d.questions.find((y) => y.id === id);
        if (x) { x.used_on = day; await writeFile(d); }
        return;
      }
      await q('UPDATE trivia_questions SET used_on = $1 WHERE id = $2', [day, id]);
    },
    async dayQuestionId(day) {
      if (!useDb) return (await readFile()).days[day] || null;
      const rows = await q('SELECT question_id FROM trivia_days WHERE day = $1', [day]);
      return rows[0] ? rows[0].question_id : null;
    },
    // First writer wins, so two people opening the page at 9:30 sharp still
    // get the same question.
    async pinDay(day, id) {
      if (!useDb) {
        const d = await readFile();
        if (!d.days[day]) { d.days[day] = id; await writeFile(d); }
        return d.days[day];
      }
      await q('INSERT IGNORE INTO trivia_days (day, question_id) VALUES ($1, $2)', [day, id]);
      return this.dayQuestionId(day);
    },
    async days() {
      if (!useDb) return Object.entries((await readFile()).days).map(([day, question_id]) => ({ day, question_id }));
      return (await q('SELECT day, question_id FROM trivia_days')).map((r) => ({ day: dOut(r.day), question_id: r.question_id }));
    },
    async play(day, userId) {
      if (!useDb) return (await readFile()).plays.find((p) => p.day === day && p.user_id === userId) || null;
      const rows = await q('SELECT * FROM trivia_plays WHERE day = $1 AND user_id = $2', [day, userId]);
      return rows[0] ? pOut(rows[0]) : null;
    },
    async startPlay(p) {
      if (!useDb) {
        const d = await readFile();
        if (!d.plays.some((x) => x.day === p.day && x.user_id === p.user_id)) {
          p.id = d.plays.reduce((m, x) => Math.max(m, x.id), 0) + 1;
          d.plays.push(p);
          await writeFile(d);
        }
        return;
      }
      await q('INSERT IGNORE INTO trivia_plays (day, user_id, user_name, department, question_id, started_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [p.day, p.user_id, p.user_name, p.department, p.question_id, p.started_at]);
    },
    // Only an unanswered play can be finished — a second /answer is a no-op.
    async finishPlay(id, f) {
      if (!useDb) {
        const d = await readFile();
        const x = d.plays.find((y) => y.id === id && y.answered_at == null);
        if (x) { Object.assign(x, f); await writeFile(d); }
        return;
      }
      await q('UPDATE trivia_plays SET answered_at=$1, choice=$2, correct=$3, ms_taken=$4, points=$5 WHERE id=$6 AND answered_at IS NULL',
        [f.answered_at, f.choice, f.correct, f.ms_taken, f.points, id]);
    },
    async deletePlay(id) {
      if (!useDb) { const d = await readFile(); d.plays = d.plays.filter((x) => x.id !== id); return writeFile(d); }
      await q('DELETE FROM trivia_plays WHERE id = $1', [id]);
    },
    async plays(from, to) {
      if (!useDb) return (await readFile()).plays.filter((p) => p.day >= from && p.day <= to);
      return (await q('SELECT * FROM trivia_plays WHERE day >= $1 AND day <= $2 ORDER BY id', [from, to])).map(pOut);
    },
  };

  /* ── Today's question ─────────────────────────────────────────── */

  async function ensureSeeded() {
    const all = await store.questions();
    if (all.length) return all;
    for (const m of seedQuestions()) await store.saveQuestion(m);
    return store.questions();
  }

  async function questionFor(day) {
    const pinned = await store.dayQuestionId(day);
    if (pinned) {
      const m = await store.question(pinned);
      if (m) return m;
    }
    const all = (await ensureSeeded()).filter((m) => m.active && m.options.length >= 2);
    if (!all.length) return null;
    let pick = all.find((m) => m.sched_date === day);
    if (!pick) {
      // Never-used first (scheduled ones wait for their date), then the one
      // used longest ago.
      const fresh = all.filter((m) => !m.used_on && !m.sched_date);
      if (fresh.length) pick = fresh[Math.floor(Math.random() * fresh.length)];
      else pick = all.filter((m) => !m.sched_date || m.sched_date < day)
        .sort((a, b) => (a.used_on || '').localeCompare(b.used_on || '') || Math.random() - 0.5)[0] || all[0];
    }
    const id = await store.pinDay(day, pick.id);
    if (id === pick.id) await store.markUsed(pick.id, day);
    return id === pick.id ? pick : store.question(id);
  }

  // A play left open past its 30 s is a time-out.
  async function settle(p) {
    if (!p || p.answered_at != null) return p;
    if (Date.now() - p.started_at <= LIMIT_MS + GRACE_MS) return p;
    const f = { answered_at: p.started_at + LIMIT_MS, choice: -1, correct: 0, ms_taken: LIMIT_MS, points: 0 };
    await store.finishPlay(p.id, f);
    return { ...p, ...f };
  }

  const askView = (m) => ({ id: m.id, question: m.question, options: m.options, category: m.category });
  const resultView = (m, p) => ({
    ...askView(m), answer_idx: m.answer_idx, fact: m.fact,
    choice: p.choice, correct: p.correct, ms_taken: p.ms_taken, points: p.points,
  });

  /* ── Leaderboards ─────────────────────────────────────────────── */

  // Consecutive played days with a right answer, counted over the days the
  // game actually ran (anyone played), so Sundays and holidays do not break it.
  function streaks(plays, today) {
    const runDays = [...new Set(plays.map((p) => p.day))].sort().reverse();
    const byUser = new Map();
    for (const p of plays) {
      if (!byUser.has(p.user_id)) byUser.set(p.user_id, new Map());
      byUser.get(p.user_id).set(p.day, p);
    }
    const out = new Map();
    for (const [uid, days] of byUser) {
      let n = 0;
      for (const d of runDays) {
        const p = days.get(d);
        if (!p) { if (d === today) continue; break; }   // not played yet today
        if (!p.correct) break;
        n++;
      }
      out.set(uid, n);
    }
    return out;
  }

  function rank(plays) {
    const users = new Map();
    for (const p of plays) {
      if (p.answered_at == null) continue;
      const u = users.get(p.user_id) || { user_id: p.user_id, name: p.user_name, department: p.department, points: 0, played: 0, correct: 0, ms: 0 };
      u.name = p.user_name || u.name;
      u.department = p.department || u.department;
      u.points += p.points; u.played += 1; u.correct += p.correct; u.ms += p.correct ? p.ms_taken : 0;
      users.set(p.user_id, u);
    }
    // Ties go to whoever answered faster in total.
    return [...users.values()].sort((a, b) => b.points - a.points || a.ms - b.ms || a.name.localeCompare(b.name));
  }

  async function board() {
    const t = istToday();
    const today = t.iso;
    const monthFrom = today.slice(0, 8) + '01';
    // 120 days back is plenty for any realistic streak.
    const since = new Date(Date.parse(today + 'T00:00:00Z') - 120 * 86400000).toISOString().slice(0, 10);
    const plays = await store.plays(since < monthFrom ? since : monthFrom, today);
    const done = plays.filter((p) => p.answered_at != null || Date.now() - p.started_at > LIMIT_MS + GRACE_MS)
      .map((p) => (p.answered_at != null ? p : { ...p, answered_at: p.started_at + LIMIT_MS, choice: -1, correct: 0, ms_taken: LIMIT_MS, points: 0 }));
    const st = streaks(done, today);
    const todayPlays = done.filter((p) => p.day === today);
    const month = rank(done.filter((p) => p.day >= monthFrom)).map((u) => ({ ...u, streak: st.get(u.user_id) || 0 }));

    const depts = new Map();
    for (const u of month) {
      const k = u.department || 'Other';
      const d = depts.get(k) || { department: k, points: 0, players: 0, played: 0, correct: 0 };
      d.points += u.points; d.players += 1; d.played += u.played; d.correct += u.correct;
      depts.set(k, d);
    }

    const pinned = await store.dayQuestionId(today);
    const m = pinned ? await store.question(pinned) : null;
    const reveal = t.hour >= REVEAL_HOUR;
    return {
      day: today,
      limitSec: LIMIT_MS / 1000,
      revealHour: REVEAL_HOUR,
      question: m ? { category: m.category, ...(reveal ? { question: m.question, answer: m.options[m.answer_idx], fact: m.fact } : {}) } : null,
      today: rank(todayPlays).map((u) => ({ ...u, streak: st.get(u.user_id) || 0 })),
      todayStats: { played: todayPlays.length, correct: todayPlays.filter((p) => p.correct).length },
      month,
      departments: [...depts.values()].map((d) => ({ ...d, avg: Math.round(d.points / Math.max(1, d.played)) }))
        .sort((a, b) => b.avg - a.avg || b.points - a.points),
      // Newest finished plays, for the screen's flash.
      recent: todayPlays.filter((p) => p.answered_at != null).sort((a, b) => b.answered_at - a.answered_at).slice(0, 10)
        .map((p) => ({ id: p.id, name: p.user_name, department: p.department, points: p.points, correct: p.correct, ms_taken: p.ms_taken, at: p.answered_at })),
    };
  }

  /* ── Routes ───────────────────────────────────────────────────── */

  function route(fn, { manage = false } = {}) {
    return async (req, res) => {
      try {
        if (useDb) await ensureSchema();
        const user = req.session.user;
        if (manage && !canManage(user)) return res.status(403).json({ error: 'Only an Admin/HOD can manage the trivia questions' });
        req.tv = { user, uid: String(user.id), manage: canManage(user) };
        const out = await fn(req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (e) {
        if (e instanceof UserError) return res.status(e.status).json({ error: e.message });
        console.error('[trivia]', req.method, req.originalUrl, '—', e.stack || e.message);
        if (!res.headersSent) res.status(500).json({ error: 'Something went wrong on the server: ' + e.message });
      }
    };
  }

  // My state for today. The question text is not in here until /start.
  app.get(`${BASE}/today`, requireAuth, route(async (req) => {
    const day = istToday().iso;
    const m = await questionFor(day);
    const base = { day, limitSec: LIMIT_MS / 1000, manage: req.tv.manage };
    if (!m) return { ...base, state: 'none' };
    const p = await settle(await store.play(day, req.tv.uid));
    if (!p) return { ...base, state: 'new', category: m.category };
    if (p.answered_at == null) return { ...base, state: 'playing', ...askView(m), remainingMs: Math.max(0, LIMIT_MS - (Date.now() - p.started_at)) };
    return { ...base, state: 'done', result: resultView(m, p) };
  }));

  app.post(`${BASE}/start`, requireAuth, route(async (req) => {
    const day = istToday().iso;
    const m = await questionFor(day);
    if (!m) bad('No trivia question today');
    const u = req.tv.user;
    let p = await store.play(day, req.tv.uid);
    if (!p) {
      await store.startPlay({
        day, user_id: req.tv.uid, user_name: str(u.name || u.email, 255), department: str(u.department, 128),
        question_id: m.id, started_at: Date.now(), answered_at: null, choice: null, correct: 0, ms_taken: null, points: 0,
      });
      p = await store.play(day, req.tv.uid);
    }
    p = await settle(p);
    if (p.answered_at != null) return { state: 'done', result: resultView(m, p) };
    return { state: 'playing', ...askView(m), remainingMs: Math.max(0, LIMIT_MS - (Date.now() - p.started_at)) };
  }));

  app.post(`${BASE}/answer`, requireAuth, route(async (req) => {
    const day = istToday().iso;
    const p = await store.play(day, req.tv.uid);
    if (!p) bad('Press Play first');
    const m = await store.question(p.question_id);
    if (!m) bad('That question is gone', 404);
    if (p.answered_at == null) {
      const ms = Date.now() - p.started_at;
      const choice = Number.isInteger(req.body?.choice) ? req.body.choice : -1;
      const late = ms > LIMIT_MS + GRACE_MS;
      const correct = !late && choice === m.answer_idx ? 1 : 0;
      const msTaken = Math.min(ms, LIMIT_MS);
      await store.finishPlay(p.id, {
        answered_at: Date.now(), choice: late ? -1 : choice, correct, ms_taken: msTaken, points: pointsFor(correct, msTaken),
      });
    }
    return { state: 'done', result: resultView(m, await store.play(day, req.tv.uid)) };
  }));

  app.get(`${BASE}/board`, requireAuth, route(async () => board()));

  /* ── Admin: questions and plays ───────────────────────────────── */

  app.get(`${BASE}/questions`, requireAuth, route(async () => {
    const day = istToday().iso;
    await questionFor(day);
    const days = await store.days();
    const timesUsed = days.reduce((a, d) => (a[d.question_id] = (a[d.question_id] || 0) + 1, a), {});
    const todayId = days.find((d) => d.day === day)?.question_id || null;
    return {
      todayId,
      questions: (await store.questions()).map((m) => ({ ...m, times_used: timesUsed[m.id] || 0 })),
      plays: (await store.plays(day, day)).map((p) => ({ id: p.id, name: p.user_name, department: p.department, points: p.points, correct: p.correct, answered: p.answered_at != null, ms_taken: p.ms_taken })),
    };
  }, { manage: true }));

  const nextQid = async () => {
    const max = (await store.questions()).reduce((mx, x) => {
      const n = parseInt(String(x.id).replace(/^TQ/, ''), 10);
      return Number.isFinite(n) && n > mx ? n : mx;
    }, 0);
    return (k = 1) => 'TQ' + String(max + k).padStart(4, '0');
  };

  app.post(`${BASE}/questions`, requireAuth, route(async (req) => {
    const m = cleanQuestion(req.body || {});
    const id = str(req.body?.id, 16);
    if (id) {
      const old = await store.question(id);
      if (!old) bad('Question not found', 404);
      await store.saveQuestion({ ...old, ...m, id });
      return { ok: true, id };
    }
    const newId = (await nextQid())();
    await store.saveQuestion({ ...m, id: newId, used_on: '', created_by: str(req.tv.user.name || req.tv.user.email) });
    return { ok: true, id: newId };
  }, { manage: true }));

  // Rows from a pasted/uploaded CSV: category, question, correct, wrong1..3, fact.
  app.post(`${BASE}/questions/import`, requireAuth, route(async (req) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
    if (!rows.length) bad('No rows to import');
    const have = new Set((await store.questions()).map((m) => m.question.toLowerCase()));
    const next = await nextQid();
    let saved = 0;
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      try {
        const right = str(r.correct, 160);
        const opts = [right, str(r.wrong1, 160), str(r.wrong2, 160), str(r.wrong3, 160)].filter(Boolean);
        const shuffled = shuffleSeeded(opts, Date.now() + i);
        const m = cleanQuestion({ ...r, options: shuffled, answer_idx: shuffled.indexOf(right) });
        if (have.has(m.question.toLowerCase())) throw new UserError('already in the bank');
        have.add(m.question.toLowerCase());
        await store.saveQuestion({ ...m, id: next(++saved), used_on: '', created_by: str(req.tv.user.name || req.tv.user.email) });
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        errors.push(`Row ${i + 2}: ${e.message}`);
      }
    }
    return { saved, errors };
  }, { manage: true }));

  // A question that has been played is switched off instead, so old results
  // keep their question.
  app.delete(`${BASE}/questions/:id`, requireAuth, route(async (req) => {
    const m = await store.question(req.params.id);
    if (!m) bad('Question not found', 404);
    const used = (await store.days()).some((d) => d.question_id === m.id);
    if (used) await store.saveQuestion({ ...m, active: 0 });
    else await store.deleteQuestion(m.id);
    return { ok: true, archived: used };
  }, { manage: true }));

  // Let someone play today's question again (browser crashed, wrong tap…).
  app.delete(`${BASE}/plays/:id`, requireAuth, route(async (req) => {
    const id = Number(req.params.id);
    const day = istToday().iso;
    const p = (await store.plays(day, day)).find((x) => x.id === id);
    if (!p) bad('Only today\'s plays can be reset', 404);
    await store.deletePlay(id);
    return { ok: true };
  }, { manage: true }));

  // The big screen.
  app.get('/trivia-screen', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(__dirname, '..', 'public', 'trivia-screen.html'));
  });
}

module.exports = { TRIVIA_SCHEMA, mountTrivia, pointsFor, seedQuestions };
