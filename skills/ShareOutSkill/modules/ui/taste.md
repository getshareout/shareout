# Design taste — ship artifacts that look professionally designed

This is the deep design reference. Read it whenever you build anything visual: a dashboard, form, report, tool, landing page, or presentation. Most AI-built pages look templated and generic; this file is the difference between "an AI made this" and "a designer made this."

**One principle above all: taste is restraint.** Fewer colors, fewer fonts, fewer effects, more whitespace, one clear action. When unsure, remove something.

## The shortcut: the design system already has taste

The fastest path to a good-looking artifact is **not** writing custom CSS — it is using the ShareOut design system. Link `shareout.css` and build with `.so-` classes (see [overview.md](overview.md)). It ships:

- Brand fonts (Satoshi display, Source Sans 3 body, JetBrains Mono) — already chosen, already paired.
- A warm, light palette with blue used sparingly — already balanced.
- Tokens for spacing (8px scale), radius, shadow, and an 8-color chart series — already harmonized.

If you use it as intended, you inherit most of the rules below for free. **The rest of this file matters in two cases:** (1) the user explicitly wants a custom look, or (2) you are making layout, hierarchy, copy, and motion decisions the stylesheet can't make for you. Those decisions are where taste lives.

## Set the dials before you build

State a one-line **design read** before generating: *page kind / audience / vibe*. The audience picks the aesthetic, not your preference — a finance dashboard, a kid's quiz, and a luxury brand deck want different things.

Then pick a level on three dials and commit to it across the whole artifact:

- **Variance** — how much layouts vary section to section. Low for data tools (predictable, scannable); high for marketing/editorial.
- **Motion** — none for dense dashboards; subtle for most; expressive only for launch/marketing pages.
- **Density** — airy for marketing and mobile; tight (tabular, compact) for data-heavy tools.

Pick **one** design language and stay in it. Don't mix warm-minimalist with brutalist-terminal in one page.

---

## Typography

- **Default to the shipped brand fonts.** If the user wants custom, choose a font with character (a real display/grotesque face). **Never ship the AI-default stack: Inter, Roboto, Arial, Open Sans, Helvetica** as a deliberate choice — they read as "no decision was made."
- **Hierarchy comes from weight and color, not just size.** A wall of huge headings has no hierarchy. Use weight (`--so-weight-bold` vs body), color (primary text vs `--so-color-text-secondary`), and space to rank things.
- **Headlines: tight tracking, tight leading.** Display text wants slightly negative letter-spacing and `line-height` near 1.1. Body text wants `line-height` 1.5–1.65.
- **Cap body line length at ~65–75 characters.** Full-width paragraphs are unreadable. Constrain with `max-width`.
- **Headlines stay short — 2 lines max.** A headline wrapping to 4 lines is a font-size problem: shrink the font and widen the container so it flows horizontally.
- **Use tabular numerals for data.** In tables, KPIs, and dashboards, numbers must align in columns — use the mono font or `font-variant-numeric: tabular-nums`.
- **Sentence case for headers**, not Title Case On Every Word. Avoid orphan words on the last line (`text-wrap: balance`).
- **Body text is never pure black.** Use the brand text token (an off-black), with a muted secondary for support text.

## Color

- **One accent, used sparingly.** ShareOut blue (`--so-color-primary`) belongs on the single primary action and active/selected states — not on every heading, border, and icon. Everything else is warm neutrals.
- **Never the "AI" look:** no purple/blue glow, no neon mesh gradients, no dark "AI" theme (unless the brand genuinely calls for it). This is the #1 fingerprint of an auto-generated page.
- **Never pure `#000` or `#fff`** for large surfaces — they kill depth. The brand tokens already use a warm off-white and an off-black; keep that.
- **One gray family.** Don't mix warm and cool grays in the same artifact.
- **Color carries meaning, not decoration.** Reserve green/red/amber for success/error/warning (use `--so-color-success`/`-error`/`-warning`). Don't tint things just to add variety.
- **Charts:** use `--so-chart-1`…`-8` (or `ShareOutUI.chartColors()`), not random hex. Cap a single chart at ~6 series before it becomes noise.

## Spacing & layout

- **More whitespace than feels natural.** Generous section padding is the cheapest way to look premium. Use the larger spacing tokens (`--so-space-12`/`-16`/`-24`) between major sections; double what feels "enough."
- **Use CSS Grid for layout**, not flexbox percentage math. Contain content in a centered max-width column, not full-bleed text.
- **Avoid the three-equal-cards feature row** — the single most generic AI layout. Vary it: a 2-column zig-zag, an asymmetric bento (e.g. one large + two small), or a different rhythm.
- **Don't repeat the same layout family** section after section. An 8-section page should use several different arrangements.
- **Optical alignment.** Align titles, prices, and CTAs across side-by-side cards; pin card actions to the bottom so they form a clean line.
- **Desktop nav on one line**, compact height. A two-line wrapping nav reads as broken.
- **Mobile-first.** Stack columns, full-width charts, 44px+ touch targets, test at a phone width. See [../mobile/design/README.md](../mobile/design/README.md).

## Depth, borders, shadows

- **Don't put a card around everything.** Cards are for real elevation/grouping. Otherwise separate with a hairline border, a divider, or whitespace. At high density, drop card chrome entirely.
- **No harsh black drop shadows.** Use the shadow tokens (`--so-shadow-sm`…`-xl`) — soft and diffuse. A heavy `box-shadow: 0 4px 8px #000` looks cheap.
- **Hairline borders**, not heavy gray lines. Use `--so-color-border`.
- **One radius system.** Pick a corner rounding and apply it everywhere (the tokens give 12–24px). Round buttons inside square cards = inconsistent = amateur.

## Motion

- **Motion must be motivated.** Every animation should justify itself in one sentence: feedback, state change, or guiding attention. "It looked cool" is not a reason. Dense dashboards usually want **no** motion.
- **Animate only `transform` and `opacity`** — never `width`/`height`/`top`/`left` (they cause layout jank). Use easing, not bare `linear`.
- **Subtle entrance reveals** (fade + small translate, ~400–600ms, gentle stagger) are enough. Don't animate everything at once, and don't loop animations forever.
- **Tactile press feedback:** interactive elements get hover, active (`transform: scale(0.98)`), and visible focus states.
- **Honor `prefers-reduced-motion`** — collapse non-trivial motion to static. Mandatory.

## Components & states

- **Ship every state, not just the happy path.** Add loading (skeletons that match the final layout, not a spinner), empty ("here's how to start," not "No data"), and error (inline, specific) states. The SDK readiness helpers and `.so-` skeletons cover most of this.
- **Forms:** label *above* the input (never placeholder-as-label), helper text in markup, errors inline below the field — never `alert()`. Use `.so-field` / `.so-label` / `.so-input`.
- **One primary action per screen** (`.so-btn-primary` once); everything else secondary or ghost. CTA label is 1–3 words and fits one line.
- **Use real assets.** Real images, real generated content — not div-based fake screenshots or placeholder text left in. Even a minimal page usually needs a real image or two.

---

## Anti-slop ban list

These are the tells that scream "auto-generated." Avoid them unless the user explicitly asks:

**Copy**
- AI clichés: "Elevate," "Seamless," "Unleash," "Next-Gen," "Game-changer," "Revolutionize," "Supercharge," "In the world of…". Write plainly.
- Generic placeholder names/brands: "John Doe," "Acme," "Nexus," "Lorem Ipsum." Use realistic content.
- Fake-perfect numbers: `99.99%`, exactly `50%`, `$100.00`. Real data is uneven (`47.2%`, `$1,284`).
- Exclamation-mark success messages and "Oops!" errors. Be calm and direct.
- Re-read every visible string before shipping; fix anything that reads like marketing filler.

**Layout & decoration**
- Eyebrow overload: an `UPPERCASE TRACKED` mini-label above every section. Use at most one per few sections — usually the headline alone is enough.
- Section-number labels (`01 / Features`, `SECTION 02`, `00 · Index`). Drop them.
- Decorative status dots on every nav item and list row (only real semantic state earns a dot).
- "Scroll to explore" cues, bouncing chevrons, fake version tags (`v0.6`, "last sync 4s ago"), locale/time/weather strips, rotated vertical text — all decoration pretending to be substance.
- The three-equal-cards row, the long `border-top`-on-every-row spec table, and 20-row data dumps on a marketing page.

**Visual**
- Purple/neon glows, AI-gradient backgrounds, oversaturated accents, gradient text on big headings.
- Heavy uniform drop shadows; mixed/random border-radius; arbitrary `z-index: 9999`.
- Default icon sets used thoughtlessly (mixed icon families, inconsistent stroke widths). Pick one family.

**Don't forget (AI usually omits these)**
- A real `<title>`, meta description, and `og:image` for sharing.
- Visible keyboard focus rings; semantic HTML (`<nav>`, `<main>`, `<article>`).
- Current-page indicator in nav; form validation; a branded favicon.

---

## Pre-ship checklist

Tick these honestly before you publish. If one can't be ticked, it's not done.

- [ ] **Design system used** where it fits (`.so-` classes + tokens), custom CSS only where genuinely needed.
- [ ] **One accent color, one font system, one radius, one gray family** — consistent across the whole artifact.
- [ ] **One primary action per screen.**
- [ ] **Generous whitespace**; sections breathe.
- [ ] **Hierarchy is clear** from weight/color/space — the eye knows where to look first.
- [ ] **No anti-slop tells** (ran the list above): no AI clichés, no eyebrow spam, no purple glow, no fake numbers, no decoration-as-substance.
- [ ] **All states present:** loading, empty, error — not just the happy path.
- [ ] **Mobile checked** at a phone width; touch targets ≥ 44px.
- [ ] **Motion is motivated** and respects `prefers-reduced-motion` (or there's no motion).
- [ ] **Copy re-read**; meta title/description/og:image set; favicon set.

## Module-specific design depth

When building a specific artifact type, also read its visual guidelines — they go deeper on archetypes, density, and patterns:

- Dashboards: [../dashboards/design/README.md](../dashboards/design/README.md) (widget density, 60/30/10 color, archetypes)
- Slides: [../slides/design/README.md](../slides/design/README.md) (one-idea slides, type scale, font pairings)
- Mobile/PWA: [../mobile/design/README.md](../mobile/design/README.md) (thumb zone, touch targets, platform conventions)
