#!/usr/bin/env node
/* Regenerates public/css/tw.css — the static stand-in for the Tailwind Play CDN.
 *
 *   node scripts/gen-tw-css.js
 *
 * Scans every file under public/ for Tailwind-shaped class tokens (class="…",
 * template strings, ternaries — anywhere), drops the ones the app's own CSS
 * already defines, and writes one rule per remaining utility using Tailwind v3's
 * default scale. Run it after adding a utility class a page has not used before;
 * the output lists anything it could not map so you can add a rule by hand.
 *
 * "primary-*" colours never existed in the CDN build (there was no
 * tailwind.config) — here they map to the brand tokens in style.css. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(PUBLIC, 'css', 'tw.css');

/* ── 1. Collect the utility tokens the pages use ─────────────────────────── */
function walk(d, out = []) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f); const s = fs.statSync(p);
    if (s.isDirectory()) walk(p, out); else if (/\.(js|html|css)$/.test(f)) out.push(p);
  }
  return out;
}
const V = '(?:(?:sm|md|lg|xl|2xl|hover|focus|active|disabled|first|last|odd|even|group-hover|placeholder|focus-visible|focus-within):)*';
const CORE = '(?:flex|inline-flex|grid|inline-grid|block|inline-block|inline|hidden|contents|absolute|relative|fixed|sticky|static|inset-[\\w.\\[\\]/-]+|top-[\\w.\\[\\]/]+|right-[\\w.\\[\\]/]+|bottom-[\\w.\\[\\]/]+|left-[\\w.\\[\\]/]+|z-\\d+|items-\\w+|justify-\\w+|self-\\w+|content-\\w+|place-\\w+-\\w+|gap(?:-[xy])?-[\\w.\\[\\]/]+|space-[xy]-[\\w.\\[\\]]+|divide-[\\w-]+|flex-\\w+|grow(?:-0)?|shrink(?:-0)?|basis-[\\w./]+|order-\\w+|grid-cols-\\w+|col-span-\\w+|row-span-\\w+|[pm][trblxy]?-[\\w.\\[\\]/]+|w-[\\w.\\[\\]/]+|h-[\\w.\\[\\]/]+|min-w-[\\w.\\[\\]/]+|max-w-[\\w.\\[\\]/]+|min-h-[\\w.\\[\\]/]+|max-h-[\\w.\\[\\]/]+|size-[\\w.\\[\\]/]+|text-[\\w.\\[\\]/-]+|font-\\w+|leading-[\\w.\\[\\]]+|tracking-\\w+|uppercase|lowercase|capitalize|normal-case|truncate|whitespace-\\w+|break-\\w+|underline|no-underline|line-through|italic|not-italic|tabular-nums|antialiased|bg-[\\w.\\[\\]/-]+|from-[\\w/-]+|via-[\\w/-]+|to-[\\w/-]+|border(?:-[trblxy])?(?:-\\d+)?|border-[\\w.\\[\\]/-]+|rounded(?:-[\\w-]+)?|ring(?:-\\d+)?|ring-[\\w/-]+|ring-offset-[\\w-]+|outline-\\w+|shadow(?:-[\\w-]+)?|opacity-\\d+|transition(?:-\\w+)?|duration-\\d+|ease-\\w+|delay-\\d+|animate-\\w+|transform|translate-[xy]-[\\w./\\[\\]]+|scale-\\d+|rotate-\\d+|cursor-[\\w-]+|select-\\w+|pointer-events-\\w+|resize(?:-\\w+)?|appearance-\\w+|overflow(?:-[xy])?-\\w+|object-\\w+|align-\\w+|sr-only|backdrop-\\w+(?:-\\w+)?|blur(?:-\\w+)?|list-\\w+|decoration-[\\w-]+|isolate|visible|invisible|group|peer)';
const TOKEN_RE = new RegExp('^!?-?' + V + CORE + '$');

function collectTokens() {
  const used = new Set(); const defined = new Set();
  const addDefined = (css) => {
    for (const m of css.matchAll(/\.((?:[a-zA-Z_!-][\w-]*|\\[^\s{,.#[])+)(?=[\s,{:>.#[)~+])/g)) defined.add(m[1].replace(/\\/g, ''));
  };
  for (const f of walk(PUBLIC)) {
    if (/vendor-form|export-lut|[\\/]tw\.css$/.test(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (f.endsWith('.css')) { addDefined(src); continue; }
    for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) addDefined(m[1]);
    for (const tok of src.split(/[\s"'`<>=;,(){}\\|&?+*]+/)) {
      if (tok && !tok.includes('$') && TOKEN_RE.test(tok)) used.add(tok);
    }
  }
  return [...used].filter(t => !defined.has(t)).sort();
}

/* ── 2. Tailwind v3 default scale ────────────────────────────────────────── */
const SP = { '0': '0px', '0.5': '0.125rem', '1': '0.25rem', '1.5': '0.375rem', '2': '0.5rem', '2.5': '0.625rem', '3': '0.75rem', '3.5': '0.875rem', '4': '1rem', '5': '1.25rem', '6': '1.5rem', '7': '1.75rem', '8': '2rem', '9': '2.25rem', '10': '2.5rem', '11': '2.75rem', '12': '3rem', '14': '3.5rem', '16': '4rem', '20': '5rem', '24': '6rem', '44': '11rem', '48': '12rem', '64': '16rem', 'px': '1px', 'auto': 'auto', 'full': '100%' };
const COLORS = {
  white: '#ffffff', black: '#000000', transparent: 'transparent',
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0', 'slate-300': '#cbd5e1', 'slate-400': '#94a3b8', 'slate-500': '#64748b', 'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b', 'slate-900': '#0f172a',
  'red-50': '#fef2f2', 'red-100': '#fee2e2', 'red-400': '#f87171', 'red-500': '#ef4444', 'red-600': '#dc2626', 'red-700': '#b91c1c',
  'amber-50': '#fffbeb', 'amber-100': '#fef3c7', 'amber-200': '#fde68a', 'amber-400': '#fbbf24', 'amber-500': '#f59e0b', 'amber-600': '#d97706', 'amber-700': '#b45309',
  'emerald-50': '#ecfdf5', 'emerald-100': '#d1fae5', 'emerald-500': '#10b981', 'emerald-600': '#059669', 'emerald-700': '#047857',
  'green-700': '#15803d', 'indigo-50': '#eef2ff', 'indigo-100': '#e0e7ff', 'indigo-700': '#4338ca',
  'orange-50': '#fff7ed', 'orange-500': '#f97316', 'orange-700': '#c2410c',
  'violet-50': '#f5f3ff', 'violet-200': '#ddd6fe', 'violet-700': '#6d28d9', 'sky-700': '#0369a1', 'pink-500': '#ec4899',
  'primary-50': 'var(--color-primary-light)', 'primary-100': 'var(--color-primary-ring)', 'primary-200': 'rgba(1,80,170,.28)',
  'primary-400': '#6BB0F5', 'primary-500': 'var(--color-primary)', 'primary-600': 'var(--color-primary)', 'primary-700': 'var(--color-primary-dark)', 'primary-800': 'var(--color-primary-dark)',
};
const TEXT_COLORS = { ...COLORS, 'primary-400': 'var(--color-primary-strong)', 'primary-500': 'var(--color-primary-strong)', 'primary-600': 'var(--color-primary-strong)', 'primary-700': 'var(--color-primary-strong)', 'primary-800': 'var(--color-primary-dark)' };
const RGB = { 'slate-50': '248,250,252', 'slate-900': '15,23,42', white: '255,255,255', 'amber-700': '180,83,9', 'slate-100': '241,245,249' };
const FS = { xs: ['0.75rem', '1rem'], sm: ['0.875rem', '1.25rem'], base: ['1rem', '1.5rem'], lg: ['1.125rem', '1.75rem'], xl: ['1.25rem', '1.75rem'], '2xl': ['1.5rem', '2rem'], '3xl': ['1.875rem', '2.25rem'], '4xl': ['2.25rem', '2.5rem'] };
const MAXW = { md: '28rem', lg: '32rem', xl: '36rem', '2xl': '42rem', xs: '20rem', sm: '24rem', full: '100%', none: 'none' };
const ROUND = { '': '0.25rem', sm: '0.125rem', md: '0.375rem', lg: '0.5rem', xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem', full: '9999px', none: '0' };
const SHADOW = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)', '': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)', lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)', '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  elevated: 'var(--shadow-md)', card: 'var(--shadow-sm)', none: '0 0 #0000',
};
const SIDES = { '': [''], t: ['-top'], r: ['-right'], b: ['-bottom'], l: ['-left'], x: ['-left', '-right'], y: ['-top', '-bottom'] };

function colorOf(map, name) {
  const m = name.match(/^(.+)\/(\d+)$/);
  if (m) { const rgb = RGB[m[1]]; if (!rgb) return null; return `rgba(${rgb},${(+m[2] / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')})`; }
  return map[name] || null;
}
function arb(v) { const m = v.match(/^\[(.+)\]$/); return m ? m[1] : null; }
function len(v) { return arb(v) || SP[v] || null; }

/* ── 3. One utility → its declarations (null = unknown) ─────────────────── */
function decl(core) {
  let m;
  if (core === 'flex') return ['display:flex'];
  if (core === 'inline-flex') return ['display:inline-flex'];
  if (core === 'grid') return ['display:grid'];
  if (core === 'block') return ['display:block'];
  if (core === 'inline-block') return ['display:inline-block'];
  if (core === 'inline') return ['display:inline'];
  if (core === 'hidden') return ['display:none'];
  if (core === 'invisible') return ['visibility:hidden'];
  if (core === 'visible') return ['visibility:visible'];
  if (['absolute', 'relative', 'fixed', 'sticky', 'static'].includes(core)) return [`position:${core}`];
  if (core === 'inset-0') return ['inset:0px'];
  if ((m = core.match(/^(top|right|bottom|left)-(.+)$/))) {
    const v = m[2] === '1/2' ? '50%' : m[2] === 'full' ? '100%' : len(m[2]); return v ? [`${m[1]}:${v}`] : null;
  }
  if ((m = core.match(/^z-(\d+)$/))) return [`z-index:${m[1]}`];
  if ((m = core.match(/^items-(start|end|center|baseline|stretch)$/))) return [`align-items:${{ start: 'flex-start', end: 'flex-end' }[m[1]] || m[1]}`];
  if ((m = core.match(/^justify-(start|end|center|between|around|evenly)$/))) return [`justify-content:${{ start: 'flex-start', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' }[m[1]]}`];
  if ((m = core.match(/^self-(start|end|center|stretch|auto)$/))) return [`align-self:${{ start: 'flex-start', end: 'flex-end' }[m[1]] || m[1]}`];
  if ((m = core.match(/^place-items-(center|start|end|stretch)$/))) return [`place-items:${m[1]}`];
  if ((m = core.match(/^gap(?:-([xy]))?-(.+)$/))) { const v = len(m[2]); if (!v) return null; return [m[1] === 'x' ? `column-gap:${v}` : m[1] === 'y' ? `row-gap:${v}` : `gap:${v}`]; }
  if (core === 'flex-1') return ['flex:1 1 0%'];
  if (core === 'flex-auto') return ['flex:1 1 auto'];
  if (core === 'flex-none') return ['flex:none'];
  if (core === 'flex-col') return ['flex-direction:column'];
  if (core === 'flex-row') return ['flex-direction:row'];
  if (core === 'flex-wrap') return ['flex-wrap:wrap'];
  if (core === 'flex-nowrap') return ['flex-wrap:nowrap'];
  if (core === 'grow') return ['flex-grow:1'];
  if (core === 'grow-0') return ['flex-grow:0'];
  if (core === 'shrink') return ['flex-shrink:1'];
  if (core === 'shrink-0') return ['flex-shrink:0'];
  if ((m = core.match(/^grid-cols-(\d+)$/))) return [`grid-template-columns:repeat(${m[1]}, minmax(0, 1fr))`];
  if ((m = core.match(/^col-span-(\d+)$/))) return [`grid-column:span ${m[1]} / span ${m[1]}`];
  if ((m = core.match(/^([pm])([trblxy]?)-(.+)$/))) {
    const v = len(m[3]); if (!v) return null;
    const prop = m[1] === 'p' ? 'padding' : 'margin';
    return SIDES[m[2]].map(s => `${prop}${s}:${v}`);
  }
  if ((m = core.match(/^(w|h)-(.+)$/))) { const v = m[2] === 'screen' ? (m[1] === 'w' ? '100vw' : '100vh') : len(m[2]); return v ? [`${m[1] === 'w' ? 'width' : 'height'}:${v}`] : null; }
  if ((m = core.match(/^min-w-(.+)$/))) { const v = len(m[1]); return v ? [`min-width:${v}`] : null; }
  if ((m = core.match(/^min-h-(.+)$/))) { const v = m[1] === 'screen' ? '100vh' : len(m[1]); return v ? [`min-height:${v}`] : null; }
  if ((m = core.match(/^max-w-(.+)$/))) { const v = arb(m[1]) || MAXW[m[1]]; return v ? [`max-width:${v}`] : null; }
  if ((m = core.match(/^max-h-(.+)$/))) { const v = arb(m[1]) || SP[m[1]]; return v ? [`max-height:${v}`] : null; }
  if ((m = core.match(/^text-(left|right|center|justify)$/))) return [`text-align:${m[1]}`];
  if ((m = core.match(/^text-\[(.+)\]$/))) return [`font-size:${m[1]}`];
  if ((m = core.match(/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl)$/))) return [`font-size:${FS[m[1]][0]}`, `line-height:${FS[m[1]][1]}`];
  if ((m = core.match(/^text-(.+)$/))) { const c = colorOf(TEXT_COLORS, m[1]); return c ? [`color:${c}`] : null; }
  if ((m = core.match(/^font-(normal|medium|semibold|bold|extrabold|light)$/))) return [`font-weight:${{ light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 }[m[1]]}`];
  if ((m = core.match(/^leading-(none|tight|snug|normal|relaxed|loose|\d+)$/))) { const v = { none: '1', tight: '1.25', snug: '1.375', normal: '1.5', relaxed: '1.625', loose: '2' }[m[1]] || SP[m[1]]; return v ? [`line-height:${v}`] : null; }
  if ((m = core.match(/^tracking-(tighter|tight|normal|wide|wider|widest)$/))) return [`letter-spacing:${{ tighter: '-0.05em', tight: '-0.025em', normal: '0em', wide: '0.025em', wider: '0.05em', widest: '0.1em' }[m[1]]}`];
  if (core === 'uppercase' || core === 'lowercase' || core === 'capitalize') return [`text-transform:${core}`];
  if (core === 'normal-case') return ['text-transform:none'];
  if (core === 'truncate') return ['overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap'];
  if ((m = core.match(/^whitespace-(nowrap|normal|pre|pre-wrap|pre-line)$/))) return [`white-space:${m[1]}`];
  if (core === 'break-words') return ['overflow-wrap:break-word'];
  if (core === 'break-all') return ['word-break:break-all'];
  if (core === 'underline') return ['text-decoration-line:underline'];
  if (core === 'no-underline') return ['text-decoration-line:none'];
  if (core === 'line-through') return ['text-decoration-line:line-through'];
  if (core === 'italic') return ['font-style:italic'];
  if (core === 'tabular-nums') return ['font-variant-numeric:tabular-nums'];
  if (core === 'antialiased') return ['-webkit-font-smoothing:antialiased', '-moz-osx-font-smoothing:grayscale'];
  if (core === 'bg-gradient-to-br') return ['background-image:linear-gradient(to bottom right, var(--tw-gradient-stops))'];
  if (core === 'bg-gradient-to-r') return ['background-image:linear-gradient(to right, var(--tw-gradient-stops))'];
  if ((m = core.match(/^from-(.+)$/))) { const c = colorOf(COLORS, m[1]); return c ? [`--tw-gradient-from:${c}`, `--tw-gradient-to:transparent`, `--tw-gradient-stops:var(--tw-gradient-from), var(--tw-gradient-to)`] : null; }
  if ((m = core.match(/^to-(.+)$/))) { const c = colorOf(COLORS, m[1]); return c ? [`--tw-gradient-to:${c}`] : null; }
  if ((m = core.match(/^bg-(.+)$/))) { const c = colorOf(COLORS, m[1]); return c ? [`background-color:${c}`] : null; }
  if (core === 'border') return ['border-width:1px'];
  if ((m = core.match(/^border-([trblxy])(?:-(\d+))?$/))) return SIDES[m[1]].map(s => `border${s}-width:${m[2] || 1}px`);
  if ((m = core.match(/^border-(\d)$/))) return [`border-width:${m[1]}px`];
  if (core === 'border-none') return ['border-style:none'];
  if (core === 'border-dashed' || core === 'border-dotted' || core === 'border-solid') return [`border-style:${core.slice(7)}`];
  if ((m = core.match(/^border-(.+)$/))) { const c = colorOf(COLORS, m[1]); return c ? [`border-color:${c}`] : null; }
  if ((m = core.match(/^rounded(?:-(.+))?$/))) { const v = ROUND[m[1] || '']; return v ? [`border-radius:${v}`] : null; }
  if ((m = core.match(/^ring(?:-(\d+))?$/))) return [`box-shadow:0 0 0 ${m[1] || 3}px var(--tw-ring-color, rgba(59,130,246,.5))`];
  if ((m = core.match(/^ring-(.+)$/))) { const c = colorOf(COLORS, m[1]); return c ? [`--tw-ring-color:${c}`] : null; }
  if (core === 'outline-none') return ['outline:2px solid transparent', 'outline-offset:2px'];
  if ((m = core.match(/^shadow(?:-(.+))?$/))) { const v = SHADOW[m[1] || '']; return v ? [`box-shadow:${v}`] : null; }
  if ((m = core.match(/^opacity-(\d+)$/))) return [`opacity:${+m[1] / 100}`];
  if (core === 'transition') return ['transition-property:color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter', 'transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1)', 'transition-duration:150ms'];
  if (core === 'transition-all') return ['transition-property:all', 'transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1)', 'transition-duration:150ms'];
  if ((m = core.match(/^duration-(\d+)$/))) return [`transition-duration:${m[1]}ms`];
  if (core === 'ease-out') return ['transition-timing-function:cubic-bezier(0, 0, 0.2, 1)'];
  if (core === 'ease-in-out') return ['transition-timing-function:cubic-bezier(0.4, 0, 0.2, 1)'];
  if (core === 'animate-spin') return ['animation:spin 1s linear infinite'];
  if (core === 'animate-pulse') return ['animation:tw-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'];
  if (core === 'transform') return ['transform:translate(var(--tw-tx, 0), var(--tw-ty, 0))'];
  if ((m = core.match(/^(-?)translate-([xy])-(.+)$/))) {
    const v = m[3] === '1/2' ? '50%' : m[3] === 'full' ? '100%' : len(m[3]); if (!v) return null;
    return [`transform:translate${m[2].toUpperCase()}(${m[1]}${v})`];
  }
  if ((m = core.match(/^cursor-(pointer|not-allowed|default|move|text|wait|grab)$/))) return [`cursor:${m[1]}`];
  if ((m = core.match(/^select-(none|all|text|auto)$/))) return [`user-select:${m[1]}`];
  if ((m = core.match(/^pointer-events-(none|auto)$/))) return [`pointer-events:${m[1]}`];
  if (core === 'appearance-none') return ['-webkit-appearance:none', 'appearance:none'];
  if ((m = core.match(/^overflow(?:-([xy]))?-(auto|hidden|visible|scroll)$/))) return [`overflow${m[1] ? '-' + m[1] : ''}:${m[2]}`];
  if ((m = core.match(/^object-(cover|contain|fill|none)$/))) return [`object-fit:${m[1]}`];
  if ((m = core.match(/^align-(middle|top|bottom|baseline)$/))) return [`vertical-align:${m[1]}`];
  if (core === 'backdrop-blur-sm') return ['backdrop-filter:blur(4px)', '-webkit-backdrop-filter:blur(4px)'];
  if (core === 'backdrop-blur') return ['backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)'];
  if ((m = core.match(/^space-([xy])-(.+)$/))) { const v = len(m[2]); return v ? [{ child: true, prop: m[1] === 'y' ? `margin-top:${v}` : `margin-left:${v}` }] : null; }
  if (core === 'sr-only') return ['position:absolute', 'width:1px', 'height:1px', 'padding:0', 'margin:-1px', 'overflow:hidden', 'clip:rect(0,0,0,0)', 'white-space:nowrap', 'border-width:0'];
  return null;
}

/* ── 4. Emit ─────────────────────────────────────────────────────────────── */
const BP = { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' };
const PSEUDO = { hover: ':hover', focus: ':focus', active: ':active', disabled: ':disabled', first: ':first-child', last: ':last-child', 'focus-visible': ':focus-visible', 'focus-within': ':focus-within', placeholder: '::placeholder', odd: ':nth-child(odd)', even: ':nth-child(even)' };
const esc = (cls) => cls.replace(/([!./\[\]:%#])/g, '\\$1');

const PREFLIGHT = `/* ── Preflight (Tailwind's base reset, kept so nothing shifts now that the
   runtime CDN build is gone). The html font-family line is deliberately
   omitted — style.css owns the app's typography. ─────────────────────── */
*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid;border-color:var(--border-base,#e5e7eb)}
::before,::after{--tw-content:''}
html{line-height:1.5;-webkit-text-size-adjust:100%;-moz-tab-size:4;tab-size:4;-webkit-tap-highlight-color:transparent}
body{margin:0;line-height:inherit}
hr{height:0;color:inherit;border-top-width:1px}
abbr:where([title]){text-decoration:underline dotted}
h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}
a{color:inherit;text-decoration:inherit}
b,strong{font-weight:bolder}
code,kbd,samp,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:1em}
small{font-size:80%}
sub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}
sub{bottom:-0.25em}
sup{top:-0.5em}
table{text-indent:0;border-color:inherit;border-collapse:collapse}
button,input,optgroup,select,textarea{font-family:inherit;font-size:100%;font-weight:inherit;line-height:inherit;letter-spacing:inherit;color:inherit;margin:0;padding:0}
button,select{text-transform:none}
button,input:where([type='button']),input:where([type='reset']),input:where([type='submit']){-webkit-appearance:button;background-color:transparent;background-image:none}
:-moz-focusring{outline:auto}
:-moz-ui-invalid{box-shadow:none}
progress{vertical-align:baseline}
::-webkit-inner-spin-button,::-webkit-outer-spin-button{height:auto}
[type='search']{-webkit-appearance:textfield;outline-offset:-2px}
::-webkit-search-decoration{-webkit-appearance:none}
::-webkit-file-upload-button{-webkit-appearance:button;font:inherit}
summary{display:list-item}
blockquote,dl,dd,h1,h2,h3,h4,h5,h6,hr,figure,p,pre{margin:0}
fieldset{margin:0;padding:0}
legend{padding:0}
ol,ul,menu{list-style:none;margin:0;padding:0}
dialog{padding:0}
textarea{resize:vertical}
input::placeholder,textarea::placeholder{opacity:1;color:var(--text-muted,#9ca3af)}
button,[role="button"]{cursor:pointer}
:disabled{cursor:default}
img,svg,video,canvas,audio,iframe,embed,object{display:block;vertical-align:middle}
img,video{max-width:100%;height:auto}
[hidden]{display:none}
@keyframes tw-pulse{50%{opacity:.5}}
`;

function build() {
  const out = []; const media = {}; const skipped = [];
  for (const tok of collectTokens()) {
    let rest = tok; let important = false; let neg = '';
    if (rest.startsWith('!')) { important = true; rest = rest.slice(1); }
    const parts = rest.split(':'); const core0 = parts.pop(); const variants = parts;
    let core = core0;
    if (core.startsWith('-')) { neg = '-'; core = core.slice(1); }
    const d = decl(neg + core);
    if (!d) { skipped.push(tok); continue; }
    let bp = null; let pseudo = '';
    for (const v of variants) { if (BP[v]) bp = v; else if (PSEUDO[v]) pseudo += PSEUDO[v]; else { pseudo = null; break; } }
    if (pseudo === null) { skipped.push(tok); continue; }
    const imp = important ? ' !important' : '';
    const rule = typeof d[0] === 'object'
      ? `.${esc(tok)} > :not([hidden]) ~ :not([hidden]){${d[0].prop}${imp}}`
      : `.${esc(tok)}${pseudo}{${d.map(x => x + imp).join(';')}}`;
    if (bp) (media[bp] = media[bp] || []).push(rule); else out.push(rule);
  }
  let css = `/* tw.css — GENERATED by scripts/gen-tw-css.js; do not edit by hand.
   Static stand-in for the Tailwind Play CDN this app used to load at runtime
   (a ~400KB in-browser compiler that re-scanned the DOM after every render).
   Only the utilities actually used under public/ are here. Added a new
   utility class to a page? Run: node scripts/gen-tw-css.js */
${PREFLIGHT}
/* ── Utilities ─────────────────────────────────────────────────────────── */
${out.join('\n')}
`;
  for (const bp of Object.keys(BP)) {
    if (media[bp]) css += `@media (min-width:${BP[bp]}){\n${media[bp].join('\n')}\n}\n`;
  }
  fs.writeFileSync(OUT, css);
  const total = out.length + Object.values(media).reduce((n, a) => n + a.length, 0);
  console.log(`wrote ${path.relative(ROOT, OUT)}: ${total} rules, ${css.length} bytes`);
  if (skipped.length) console.log('not utilities / unmapped (ignored):', skipped.join(' '));
}

build();
