# Page Composition (Marketing & Landing)

Rules for composing multi-section marketing surfaces: the landing page, the logged-out home, feature pages. Implemented in `shareout-app/src/pages/` (`landing.ts`, `home.ts`).

This is about **arrangement**, not pixels. Tokens, color, and type live elsewhere; this doc governs how sections add up to a page that doesn't look auto-generated.

> ShareOut is warm, quiet, and fast. Borrow the discipline below from landing-page best practice, **not** the cinematic dials. No scroll-hijack, no marquees, no editorial serif heroes, no dark glass. Motion stays in service of clarity (reveal, fade, guide), never spectacle. See [../principles/anti_patterns.md](../principles/anti_patterns.md) and [../visual/media.md](../visual/media.md).

---

## Hero

The hero is one moment, not a feature list.

- **Fits the first viewport.** Headline ≤ 2 lines on desktop. Subtext ≤ 20 words. Primary CTA visible without scrolling.
- **Max 4 text elements**, in this order: (1) optional eyebrow *or* brand strip — pick zero or one, (2) headline, (3) subtext, (4) CTAs (one primary + at most one secondary).
- **Plan font size and visual together.** If the asset is large and the headline runs long, don't open at the biggest scale. A 4-line hero headline is a font-size mistake, not a copy problem.
- **Top padding stays modest.** Don't float the hero content halfway down the screen; if it needs air, grow the type or the asset, not the padding.
- **Banned in the hero:** trust micro-strip ("Used by teams at…"), version/status labels (BETA, v0.6, EARLY ACCESS) unless the page is literally a launch, pricing teaser, feature bullets, a tagline tucked under the CTAs. All of those move to their own sections below.
- **Real visual.** A gradient blob behind text is a placeholder, not a hero. Use a real screenshot, a real product preview, or warm brand photography (see [../visual/media.md](../visual/media.md)). Never a `<div>`-built fake product UI.

---

## Section rhythm

A page is a sequence of distinct chapters, not the same block repeated.

- **No layout-family repeats.** Once a section uses a pattern (3-up cards, split text+image, full-width quote), that family appears at most once. An 8-section page uses at least 4 different families.
- **Zigzag cap.** At most 2 consecutive "image one side, text the other" sections. The 3rd in a row is a fail — break it with a full-width band, a stacked section, or a grid.
- **No three equal feature cards.** The generic 3-identical-cards row is the classic tell. Use a 2-column zigzag, an asymmetric grid, or a different family.
- **Generous vertical breathing room** between sections (the spacing scale tops out at 96–128px for exactly this). When in doubt, more space.

---

## Eyebrows & labels

The small uppercase label above a section headline. Every AI page puts one on every section, producing the same templated beat.

- **Max 1 eyebrow per 3 sections** (the hero counts as one). Most sections need none — the headline alone is enough, and the section's position already categorizes it.
- **No section numbering** (`01 / INDEX`, `002 · Features`, `Step 1 / Step 2`). The content is the label.
- **No micro-meta sentences** under a heading ("Each of these ships today, not a roadmap promise…"). Eyebrow + headline + body is the whole budget.
- **No decoration text strips** at the hero bottom (`PUBLISH · SHARE · LIVE`) and **no scroll cues** ("Scroll to explore", animated wheels). If they haven't scrolled, they're looking at the hero; they know how.

---

## Bento & grids

- **Exact cell count.** N items → N cells. No empty tile in the middle or trailing the grid. If a cell is blank, reshape the grid.
- **Rhythm, not repetition.** Vary tile sizes; don't stack identical rows.
- **Visual variety.** At least 2–3 cells carry a real visual (screenshot, warm photo, tasteful tinted background), not all text-on-white cards.

---

## Calls to action

- **One intent, one label, page-wide.** "Create Page", "Get Started", "Try it", "Start building" are all the same intent — pick one wording and use it in nav, hero, and footer. Two labels for the same action is a fail (and conflicts with the single-action principle in [../principles/design_principles.md](../principles/design_principles.md)).
- Specific verb, not "Get Started" alone. See [../brand/voice.md](../brand/voice.md).
- Label fits on one line at desktop; never let a CTA wrap.

---

## Social proof / logo wall

- Lives **below** the hero, never inside it.
- **Logos only** — no industry label printed under each logo ("Stripe · payments").
- Real marks (SVG), monochrome to match the page, legible in both themes. Not plain styled text wordmarks.

---

## Images

- Every marketing page is a visual product. Even the most restrained version needs real images (hero + at least one supporting shot).
- **Never** `<div>`-based fake screenshots, never hand-rolled decorative SVG scenes, never a pure-text "minimalist" page.
- Follow brand direction in [../visual/media.md](../visual/media.md): real people, warm light, desaturated, no stock handshakes.

---

## Pre-ship checklist

- [ ] Hero fits the viewport: headline ≤ 2 lines, subtext ≤ 20 words, CTA visible
- [ ] Hero has ≤ 4 text elements; no trust strip / version label / pricing teaser inside it
- [ ] ≥ 4 different layout families across the page; no 3-equal-card row
- [ ] ≤ 2 consecutive image+text-split sections
- [ ] Eyebrows ≤ ceil(sections ÷ 3); no section numbering; no scroll cues
- [ ] Bento has exact cell count, no empty tiles, real visual variety
- [ ] One CTA intent, one label, page-wide; no wrapping CTA
- [ ] Logo wall below hero, logos only, both themes
- [ ] Real images everywhere; zero div-fake screenshots
- [ ] Motion serves clarity only; reduced-motion honored; one page theme (no section flips)

---

*See also: [../principles/design_principles.md](../principles/design_principles.md) · [layout.md](layout.md) · [../visual/media.md](../visual/media.md)*
