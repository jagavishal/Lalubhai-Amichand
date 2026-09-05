# UI/UX Build Prompt — New ERP System

Paste everything below the line into Claude / ChatGPT / v0 / Cursor, and attach the
new system's logo file. Replace the two bracketed placeholders first.

---

You are a senior product designer and front-end engineer. Build the complete UI
design system and application shell for an internal business ERP used daily by
office staff, factory staff and management on desktop and phone.

**Product name:** [NEW SYSTEM NAME]
**Logo:** attached. Everything about the palette derives from it — see Section 1.
**Stack:** [YOUR STACK — e.g. plain HTML + CSS custom properties + vanilla JS, or React + Tailwind]

This is a dense, data-heavy internal tool, not a marketing site. Optimise for
scanning long tables, filling forms quickly, and low eye-strain over an 8-hour
shift. Restraint beats decoration. No gradients-as-personality, no rounded-blob
illustrations, no oversized hero sections.

---

## 1. Brand colour — derive it from the logo, do not invent it

Do this first and show your working before writing any CSS.

**Step 1 — sample two colours from the logo.**

- `primary` = the dominant structural colour (usually the wordmark / most of the
  ink). This carries navigation, buttons, links, focus rings, active states.
- `accent` = the secondary emphasis colour of the logo mark or symbol. This is
  for brand moments only — logo tiles, the active-nav bar, highlight rules.

If the logo is single-colour, derive `accent` as a deliberately contrasting hue
and say so. If it has more than two, pick the two with the largest area and
report which you dropped.

**Step 2 — hard rule on the accent.** `accent` is NEVER used for destructive
actions. Delete/danger keeps its own red scale. If your logo accent is itself
red, they must be visibly different reds, and buttons only ever use the danger
red — otherwise "delete" and "on brand" look identical and people click wrong.

**Step 3 — check contrast before committing.**

- Measure `primary` against white. Report the ratio.
- If it clears 4.5:1, brand-coloured text on pale surfaces is fine — use the same
  hue for text, do not invent a lightened variant that fails contrast.
- If it clears roughly 7:1, white text sits safely on a solid `primary` fill.
- If it does NOT clear 4.5:1 (a light / yellow / cyan logo), set the on-primary
  text token to a dark ink instead of white, and define a separate darkened
  `primary-strong` for text and icon strokes. Say which case applies.

**Step 4 — derive the ramp** from the two sampled colours:

- `-dark` ≈ 12–18% darker, for hover and gradient ends
- `-light` = same hue at ~10% alpha, for tinted chip and row-highlight fills
- `-ring` = same hue at ~22% alpha, for focus rings
- Use alpha, not pre-mixed opaque tints, so they sit correctly on both themes.

**Step 5 — the navigation rail is always dark, in both themes.** Do not paint it
`primary`. Build a near-black colour tinted toward the brand hue (a brand-blue
logo gets a navy rail, a green logo a deep pine rail), then give the rail its own
tokens, because the base brand colour is usually near-invisible on it:

- rail active icon/label = a *lifted*, lighter version of the brand hue
- rail active indicator bar = the `accent` colour
- rail active row background = brand hue at ~18% alpha

State the final palette as a table of token → hex → what it is used for, and note
the contrast ratio of every text/background pair you introduce.

## 2. Token contract

Everything is CSS custom properties on `:root`. No raw hex anywhere in component
code — if you need a colour that has no token, add a token.

Define these groups:

- **Brand:** `--color-primary`, `-dark`, `-light`, `-ring`, `-text` (ink that sits
  on a solid primary fill), `-strong` (brand-coloured text on a pale surface);
  the same six for `--color-accent`.
- **Neutrals:** a 50→900 grey ramp, cool-tinted (slate) not pure grey.
- **Semantic:** `success`, `warning`, `danger`, `info`, `neutral`, `purple` — each
  with `-bg`, `-border`, `-text` so chips, banners and pills are one lookup.
- **Surfaces:** `--app-bg`, `--surface`, `--surface-alt`, `--text-primary`,
  `--text-secondary`, `--text-muted`, `--border-light/base/strong`.
- **Scales:** spacing 4→48px; radius 6/8/12/16/20; a five-step shadow scale
  (`xs` hairline → `xl` modal); type scale roughly 10.5 / 11 / 12.5 / 13.5 / 15 /
  17 / 19px with weights 400/500/600/700.
- **Rail:** its own `--sidebar-*` set including collapsed and expanded widths.

The type scale is small on purpose — this is an information-dense tool. Body text
sits at ~13.5px, table cells ~12.5px, field labels ~10px uppercase with wide
tracking. Do not scale it up to consumer-app sizes.

## 3. Dark mode

`html[data-theme="dark"]` re-declares **only** the tokens that change. Components
are never dark-aware; they only read tokens.

- Surfaces go to a soft near-black, not pure `#000`.
- **Lift the brand colour.** A brand colour tuned for white backgrounds is almost
  always too dark to carry white text on a dark surface — raise its lightness a
  step, and make `-strong` a much lighter tint for text.
- Semantic chips switch from solid pale fills to ~15% alpha of the base hue, with
  a lightened text colour.
- The rail does not change — it is dark in both themes.

Persist the choice in `localStorage`; on first visit fall back to
`prefers-color-scheme`. Provide a sun/moon toggle in the top bar.

## 4. App shell

- **Collapsed icon rail, 52px wide, expanding to ~228px on hover** with a 220ms
  ease. Labels fade in; the page content shifts by the same amount so the
  expanded rail never covers what you are reading.
- **Nav grouped into collapsible sections** named after how the business actually
  works (e.g. Basic / departments / Admin / Accounts), each foldable by a
  chevron. Remember open sections per browser; on a first visit open only the
  section containing the current page.
- A section whose every item is hidden by permissions **renders nothing at all** —
  no empty heading.
- **Mobile (<768px):** rail hidden entirely, replaced by a fixed bottom tab bar of
  5–6 destinations with count badges.
- Top bar carries the page title, theme toggle, and user menu.
- Route changes paint a **centred spinner immediately**, then render — never a
  blank frame.

## 5. Components to specify and build

Buttons (`primary / secondary / ghost / danger / success / warning`, in
`xs/sm/base/lg`), icon buttons, text/select/textarea inputs with focus ring,
labels, cards (static and hover-lift), tables (sticky header, zebra-free with
hairline row borders, horizontally scrollable in their own container), pills and
count badges in every semantic colour, stat tiles, segmented controls, modals
(header with icon + title + subtitle, scrollable body, sticky footer), confirm
dialogs, toasts, skeleton loaders, empty states with icon + message + action, an
image lightbox, and a print stylesheet.

Every interactive element needs a visible keyboard focus state using `-ring`.

## 6. Advanced behaviour — build these, they are the difference

1. **Per-user page permissions.** Each user carries a list of pages they may see;
   the nav and the router both enforce it. Admin/HOD bypass. Include an admin
   screen with a permission matrix of user × page.
2. **Feature flags.** A nav item can be gated on a server-sent flag so a whole
   module can be switched off without deleting code.
3. **Legacy permission aliases.** When a page is split or renamed, old saved
   permission keys must keep granting access — never let a rename silently strip
   people's access.
4. **Hidden-but-live routes.** Maintenance/console pages resolve by URL but carry
   no nav entry.
5. **Live count badges** on nav items (pending approvals), fetched on load.
6. **Inline "+ Add new" inside dropdowns.** Choosing "+ Add new" overlays a small
   text input over the select; saving writes to the shared master list and the
   value becomes immediately available in every other dropdown app-wide — without
   losing the half-filled form behind it. This is the single biggest data-entry
   speed win; do not skip it.
7. **Unknown-value preservation.** If a record holds a dropdown value no longer in
   the list, render it as its own selected option rather than falling back to the
   placeholder — editing an unrelated field must never silently wipe it.
8. **Bulk CSV import** with a downloadable sample, per-row validation, and an
   error report that names the failing row instead of aborting the batch.
9. **Photo upload** with crop, avatar fallback to coloured initials, and
   click-to-zoom lightbox.
10. **Toasts on every mutation, followed by a re-fetch of the list**, so two people
    editing the same data cannot drift apart.
11. **Search + filter on every list**, filtering across all visible columns.
12. **Export to spreadsheet** on every report screen.

## 7. Accessibility and responsiveness

- WCAG AA minimum on all text. State the ratio for each pair you introduce.
- Honour `prefers-reduced-motion` — disable transitions and animations under it.
- Full keyboard operability, `sr-only` labels on icon-only buttons, `aria-expanded`
  on every collapsible.
- Breakpoints at 768px, 640px and 480px. Tables become stacked cards on phones.
- Touch targets at least 40px on mobile.

## 8. Deliver

1. The colour derivation from Section 1, with sampled hexes and contrast ratios.
2. A complete `:root` + `[data-theme="dark"]` token sheet, commented — each comment
   saying *why* the value is what it is, not restating the hex.
3. The component CSS.
4. The app shell (rail, sections, top bar, mobile bottom nav) as working code.
5. One example dense list screen and one example modal form, proving the tokens.

**Acceptance check before calling it done:** no raw hex outside the token sheet;
every semantic colour has bg/border/text; dark mode implemented purely as token
overrides; the accent colour appears nowhere on a destructive control; the rail is
dark in both themes; every contrast pair stated and passing.
