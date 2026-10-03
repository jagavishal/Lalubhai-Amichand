'use strict';
/* Festival greeting mail — banner, "Dear Team," with a quote, then a short
   message, the way the office's own Gandhi Jayanti mail was laid out.

   The occasion name comes straight off the holiday calendar, which is typed by
   hand ("Mahatma Gandhi Day", "Diwali (Laxmi Pujan)", ...), so each theme is
   picked by a loose pattern rather than an exact name. Anything that matches
   nothing still gets the same layout with a plain wish.

   Built with tables and inline styles only: Outlook ignores CSS gradients and
   most layout CSS, so every gradient sits on top of a solid bgcolor that is
   what Outlook shows instead. */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ordinal = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// Colour sets. a = first highlight colour, b = second.
const TRICOLOUR = {
  gradient: '#FF9933 0%, #FFFFFF 50%, #138808 100%',
  solid: '#FFE3C2', quoteBg: '#FFF7EF', a: '#FF9933', b: '#138808',
};
const FESTIVE = {
  gradient: '#F59E0B 0%, #FDE68A 50%, #EA580C 100%',
  solid: '#FDE68A', quoteBg: '#FFFBEB', a: '#C2410C', b: '#B45309',
};

// {a}..{/a} and {b}..{/b} mark the highlighted words in a message.
const THEMES = [
  {
    match: /gandhi/i,
    title: 'Happy Gandhi Jayanti',
    extra: (year) => `${ordinal(year - 1869)} Birth Anniversary`,
    quote: 'Be the change that you wish to see in the world',
    by: 'Mahatma Gandhi',
    message: 'On this day, we honor the {a}Father of the Nation{/a} and his timeless principles of truth, non-violence, and peace.<br>'
      + 'May his teachings inspire us to lead lives of {b}compassion, integrity, and service{/b} to humanity.',
    colours: TRICOLOUR,
  },
  {
    match: /independence/i,
    title: 'Happy Independence Day',
    quote: 'At the stroke of the midnight hour, when the world sleeps, India will awake to life and freedom.',
    by: 'Jawaharlal Nehru',
    message: 'On this day, we salute the {a}freedom fighters{/a} whose courage and sacrifice gave us a free nation.<br>'
      + 'May we keep building an India of {b}unity, progress, and pride{/b}.',
    colours: TRICOLOUR,
  },
  {
    match: /republic/i,
    title: 'Happy Republic Day',
    quote: 'Constitution is not a mere lawyers’ document; it is a vehicle of life, and its spirit is always the spirit of age.',
    by: 'Dr. B. R. Ambedkar',
    message: 'On this day, we celebrate the {a}Constitution of India{/a} and the democratic values it stands for.<br>'
      + 'May we always uphold the ideals of {b}justice, liberty, equality, and fraternity{/b}.',
    colours: TRICOLOUR,
  },
  {
    match: /diwali|deepavali|laxmi|lakshmi/i,
    title: 'Happy Diwali',
    quote: 'May the light of the diyas brighten every corner of your life',
    message: 'Wishing you and your family a Diwali filled with {a}light, joy, and prosperity{/a}.<br>'
      + 'May the year ahead bring you {b}good health, success, and happiness{/b}.',
    colours: FESTIVE,
  },
  {
    match: /new\s*year|bestu|varsh/i,
    title: 'Happy New Year',
    quote: 'Every new beginning comes from some other beginning’s end',
    by: 'Seneca',
    message: 'Thank you for everything you brought to the team this past year.<br>'
      + 'May the new year bring you {a}fresh opportunities{/a} and {b}many reasons to smile{/b}.',
    colours: FESTIVE,
  },
  {
    match: /holi\b|dhuleti|dhulandi/i,
    title: 'Happy Holi',
    quote: 'May the colours of Holi fill your life with happiness',
    message: 'Wishing you and your family a {a}joyful and colourful{/a} Holi.<br>'
      + 'May this festival bring {b}love, laughter, and togetherness{/b} to your home.',
    colours: {
      gradient: '#EC4899 0%, #FACC15 35%, #22D3EE 70%, #8B5CF6 100%',
      solid: '#FBCFE8', quoteBg: '#FDF2F8', a: '#DB2777', b: '#7C3AED',
    },
  },
  {
    match: /dussehra|dasara|dussera|vijaya/i,
    title: 'Happy Dussehra',
    quote: 'May the victory of good over evil inspire us every day',
    message: 'On this day, we celebrate the triumph of {a}truth and righteousness{/a}.<br>'
      + 'May this Dussehra bring you {b}courage, strength, and success{/b} in all you do.',
    colours: { ...FESTIVE, gradient: '#DC2626 0%, #FDBA74 50%, #F59E0B 100%', solid: '#FDBA74', a: '#DC2626' },
  },
  {
    match: /navratri|navaratri/i,
    title: 'Happy Navratri',
    quote: 'May Maa Durga bless you with strength, wisdom, and joy',
    message: 'Wishing you and your family nine nights of {a}devotion, dance, and celebration{/a}.<br>'
      + 'May the Goddess bless your home with {b}peace and prosperity{/b}.',
    colours: { ...FESTIVE, gradient: '#BE123C 0%, #FDE68A 50%, #F97316 100%', solid: '#FECDD3', a: '#BE123C' },
  },
  {
    match: /ganesh|ganpati|vinayak/i,
    title: 'Happy Ganesh Chaturthi',
    quote: 'Ganpati Bappa Morya!',
    message: 'May Lord Ganesha remove every obstacle from your path and bless you with {a}wisdom and good fortune{/a}.<br>'
      + 'Wishing you and your family {b}happiness and prosperity{/b}.',
    colours: FESTIVE,
  },
  {
    match: /sankranti|uttarayan|pongal|lohri/i,
    title: 'Happy Makar Sankranti',
    quote: 'May your spirits soar as high as the kites in the sky',
    message: 'Wishing you and your family a festival of {a}sunshine, kites, and sweetness{/a}.<br>'
      + 'May the season bring you {b}new energy and abundance{/b}.',
    colours: {
      gradient: '#38BDF8 0%, #FEF9C3 50%, #F59E0B 100%',
      solid: '#BAE6FD', quoteBg: '#F0F9FF', a: '#0284C7', b: '#D97706',
    },
  },
  {
    match: /raksha|rakhi/i,
    title: 'Happy Raksha Bandhan',
    quote: 'A thread of love, a promise of protection',
    message: 'Wishing you and your family a {a}joyful Raksha Bandhan{/a}.<br>'
      + 'May the bond between siblings always stay {b}strong and loving{/b}.',
    colours: FESTIVE,
  },
  {
    match: /janmashtami|krishna/i,
    title: 'Happy Janmashtami',
    quote: 'Change is the law of the universe',
    by: 'Bhagavad Gita',
    message: 'May Lord Krishna fill your life with {a}love, joy, and wisdom{/a}.<br>'
      + 'Wishing you and your family a {b}blessed Janmashtami{/b}.',
    colours: {
      gradient: '#1E3A8A 0%, #93C5FD 50%, #FACC15 100%',
      solid: '#BFDBFE', quoteBg: '#EFF6FF', a: '#1D4ED8', b: '#CA8A04',
    },
  },
  {
    match: /\beid\b|ramzan|ramadan|bakri|id-ul|idul/i,
    title: 'Eid Mubarak',
    quote: 'May this Eid bring peace, happiness, and blessings to all',
    message: 'Wishing you and your family a {a}blessed and joyous Eid{/a}.<br>'
      + 'May the day bring {b}peace, harmony, and togetherness{/b} to your home.',
    colours: {
      gradient: '#047857 0%, #D1FAE5 50%, #FACC15 100%',
      solid: '#A7F3D0', quoteBg: '#ECFDF5', a: '#047857', b: '#B45309',
    },
  },
  {
    match: /christmas|x-?mas/i,
    title: 'Merry Christmas',
    quote: 'Peace on earth, and goodwill to all',
    message: 'Wishing you and your family a {a}merry Christmas{/a}.<br>'
      + 'May the season bring you {b}warmth, joy, and togetherness{/b}.',
    colours: {
      gradient: '#B91C1C 0%, #FFFFFF 50%, #15803D 100%',
      solid: '#FECACA', quoteBg: '#FEF2F2', a: '#B91C1C', b: '#15803D',
    },
  },
  // Days of mourning — no "Happy", no celebration.
  {
    match: /good\s*friday|muharram|ashura/i,
    title: null, // the holiday's own name, unadorned
    quote: 'Peace I leave with you',
    message: 'On this solemn day, we pause in {a}reflection and remembrance{/a}.<br>'
      + 'Wishing you and your family {b}peace and calm{/b}.',
    colours: {
      gradient: '#64748B 0%, #F1F5F9 50%, #94A3B8 100%',
      solid: '#E2E8F0', quoteBg: '#F8FAFC', a: '#475569', b: '#334155',
    },
    solemn: true,
  },
  {
    match: /maharashtra|gujarat/i,
    title: null,
    quote: 'Proud of our roots, confident of our future',
    message: 'Wishing you a very happy {a}__NAME__{/a}.<br>'
      + 'May the state we work in keep growing in {b}culture, enterprise, and prosperity{/b}.',
    colours: FESTIVE,
  },
];

const FALLBACK = {
  title: null,
  quote: null,
  message: 'Wishing you and your family a very happy {a}__NAME__{/a}.<br>'
    + 'May the day bring you {b}joy, peace, and prosperity{/b}.',
  colours: FESTIVE,
};

// The mail for one occasion, given the date it is sent on ("YYYY-MM-DD").
function festivalMail(occasion, iso) {
  const name = String(occasion || '').trim();
  const theme = THEMES.find((t) => t.match.test(name)) || FALLBACK;
  const [y, m, d] = String(iso || '').split('-').map(Number);

  const title = theme.title
    || (theme.solemn || /^happy\b/i.test(name) ? name : `Happy ${name}`);
  const dateLine = m && d ? `${MONTHS[m - 1]} ${ordinal(d)}` : '';
  const sub = [dateLine, theme.extra && y ? theme.extra(y) : ''].filter(Boolean).join(' &bull; ');

  const c = theme.colours;
  const message = theme.message
    .replace(/__NAME__/g, esc(name))
    .replace(/\{a\}/g, `<b style="color:${c.a}">`).replace(/\{\/a\}/g, '</b>')
    .replace(/\{b\}/g, `<b style="color:${c.b}">`).replace(/\{\/b\}/g, '</b>');

  const font = `'Segoe UI',Calibri,Arial,sans-serif`;
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F4F4" style="background:#F4F4F4;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:${font}">
      <tr><td align="center" bgcolor="${c.solid}" style="background-color:${c.solid};background-image:linear-gradient(135deg, ${c.gradient});padding:34px 24px 30px">
        <h1 style="margin:0;font-size:34px;line-height:1.2;color:#333333;font-weight:700">${esc(title)}</h1>
        ${sub ? `<p style="margin:12px 0 0;font-size:16px;color:#4B4B4B;font-weight:600">${sub}</p>` : ''}
      </td></tr>
      <tr><td align="center" bgcolor="${c.quoteBg}" style="background:${c.quoteBg};padding:34px 32px">
        <p style="margin:0;font-size:24px;font-weight:700;color:${c.a}">Dear Team,</p>
        ${theme.quote ? `<p style="margin:20px 0 0;font-size:18px;font-style:italic;color:#333333;line-height:1.5">${esc(theme.quote)}</p>` : ''}
        ${theme.quote && theme.by ? `<p style="margin:14px 0 0;font-size:15px;font-weight:700;color:${c.b}">- ${esc(theme.by)}</p>` : ''}
      </td></tr>
      <tr><td align="center" bgcolor="#FFFFFF" style="background:#FFFFFF;padding:34px 40px 30px">
        <p style="margin:0;font-size:16px;line-height:1.9;color:#333333">${message}</p>
        <p style="margin:30px 0 0;font-size:14px;color:#555555">Warm regards,<br><b style="color:#333333">Lallubhai Amichand Limited</b></p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  return { subject: theme.solemn ? title : `${title}!`, html };
}

module.exports = { festivalMail };
