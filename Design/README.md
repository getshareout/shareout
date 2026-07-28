# ShareOut Design System

**Source of truth** for brand, principles, visual identity, and product UI.

Start here. Each folder owns one concern — read only what you need.

## If you are self-hosting

This is ShareOut's own design system — the taste the product ships with, so a fresh
deploy looks finished instead of unstyled. **It is yours to change.** Retheme it,
rename it, or replace it wholesale:

- **Colors, type, spacing, radius** — documented in `visual/` and `system/tokens.md`;
  the values that actually ship live in one place in code,
  `shareout-app/packages/design-tokens/`. Edit them there and the app UI and the
  published-artifact stylesheet both follow — you rarely need to touch components.
- **Logo and brand art** — swap the files in `brand-art/` (`shareout_logo.png`,
  `shareout_logo_with_name.png`, `shareout_logo_favicon.png`), keeping the
  filenames, and the app and docs pick them up.
- **Voice and copy rules** — `brand/voice.md`. Positioning and manifesto describe
  ShareOut as a product; rewrite them for your own org if you fork.
- **Your own system instead** — keep the token *names* exported from
  `@shareout/design-tokens` and point their values at your palette; components and
  the artifact stylesheet read them by name, so nothing else has to change.

`npm run check:design-tokens` guards against hardcoded values that bypass tokens —
that check keeps *your* theme consistent too. Contributions back to this repo should
stay consistent with `Design/` rather than introducing a second style.

---

## Document map

| I need to… | Read |
|------------|------|
| Understand what ShareOut stands for | [brand/manifesto.md](brand/manifesto.md) |
| Know audience, category, competitive framing | [brand/positioning.md](brand/positioning.md) |
| Write copy, buttons, errors, empty states | [brand/voice.md](brand/voice.md) |
| Make product/UI decisions | [principles/design_principles.md](principles/design_principles.md) |
| Build accessible interfaces | [principles/accessibility.md](principles/accessibility.md) |
| Avoid generic AI / enterprise aesthetics | [principles/anti_patterns.md](principles/anti_patterns.md) |
| Apply logo, color, type at brand level | [visual/](visual/) |
| Implement layouts, tokens, components in code | [system/](system/) |
| Compose a landing / marketing / home page | [system/page-composition.md](system/page-composition.md) |
| Ship the design system to published artifacts (SDK) | [system/artifact-ui.md](system/artifact-ui.md) |
| Brief an external designer on logo/identity | [handoff/brand_brief.md](handoff/brand_brief.md) |

---

## Folder architecture

```
Design/
├── README.md                 ← You are here
│
├── brand/                    ← WHY ShareOut exists (strategy, not pixels)
│   ├── manifesto.md          Mission, vision, personality, north star
│   ├── positioning.md        Audience, category, what we replace
│   └── voice.md              Tone, microcopy, good/bad examples
│
├── principles/               ← HOW we decide (rules for any surface)
│   ├── design_principles.md  Pillars, aesthetic, grandma test
│   ├── accessibility.md      Non-negotiables, real-world tests
│   └── anti_patterns.md      Explicit don'ts (AI slop, enterprise chrome)
│
├── visual/                   ← WHAT it looks like (brand layer)
│   ├── identity.md           Visual philosophy, references, avoid list
│   ├── logo.md               Symbol, wordmark, sizes, clear space
│   ├── color.md              Palette, ratios, forbidden colors
│   ├── typography.md         Display, body, mono stacks and scale
│   └── media.md              Photography and illustration direction
│
├── system/                   ← HOW to build (product layer)
│   ├── overview.md           Narrative design system (v2)
│   ├── layout.md             Page structure, breakpoints, grid
│   ├── page-composition.md   Hero, section rhythm, eyebrows, CTAs (marketing/landing)
│   ├── tokens.md             CSS custom properties (spacing, radius, motion, z-index)
│   ├── components.md         Buttons, inputs, cards, modals, states
│   └── artifact-ui.md        Design system shipped to artifacts (shareout.css SDK)
│
└── handoff/                  ← External designer deliverables
    └── brand_brief.md        Logo brief, checklist, open questions
```

---

## Layer model

Three layers, bottom to top:

1. **Brand** — beliefs, audience, voice. Changes rarely.
2. **Visual** — logo, color, type, media. Brand expression; harmonizes with product.
3. **System** — tokens and components. What engineers implement in `shareout-app/src/design-system/`.

Principles cut across all three — every decision filters through them.

---

## Code alignment

Product tokens live in:

- `shareout-app/src/design-system/tokens.ts`
- `shareout-app/src/design-system/base.css.ts`

When docs and code diverge, **update code to match Design/** — then run `npm test` (includes `test/design-system/tokens.test.ts`).

---

## Former root files (removed)

These root-level files were consolidated and deleted. Edit `Design/` instead.

| Former file | Now in |
|-------------|--------|
| `DESIGN.md` | `principles/` + `system/tokens.md` + `system/components.md` |
| `SHAREOUT_DESIGN_PHILOSOPHY.md` | `principles/` + `brand/voice.md` |
| `SHAREOUT_UI_SPECIFICATIONS.md` | `system/layout.md` + `system/tokens.md` + `system/components.md` |
| `SHAREOUT_BRAND_BRIEF.md` | `handoff/brand_brief.md` |

---

## Version

Design System **v2.0** — *From Idea to Live*

North star: **Ideas deserve to exist.**
