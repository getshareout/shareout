# Design System Overview

## Version 2.0 — From Idea to Live

This document is the narrative hub for the ShareOut product design system. Detailed specs live in sibling folders — read this first for context, then drill into modules.

---

## What is ShareOut?

ShareOut is the fastest way to turn an idea into something real on the web.

Not documents. Not exports. Not files. **Experiences.**

Whatever someone imagines, ShareOut helps bring it to life and publish it instantly.

---

## Core Narrative

**Before:** Idea → Document → Export → Email → Link

**After:** Idea → ShareOut → Live

---

## Brand Personality in Product

| Trait | In the UI |
|-------|-----------|
| **Easy** | Grandma-readable. No jargon. No enterprise complexity. |
| **Fast** | Instant, responsive, lightweight. No waiting. |
| **Powerful** | Enterprise-capable without intimidation. |

Human traits: Warm · Optimistic · Confident · Creative · Helpful · Modern · Approachable

---

## Module Map

| Topic | Document |
|-------|----------|
| Beliefs, mission, north star | [../brand/manifesto.md](../brand/manifesto.md) |
| Audience, category | [../brand/positioning.md](../brand/positioning.md) |
| Copy, microcopy | [../brand/voice.md](../brand/voice.md) |
| Decision rules | [../principles/design_principles.md](../principles/design_principles.md) |
| Visual philosophy | [../visual/identity.md](../visual/identity.md) |
| Logo | [../visual/logo.md](../visual/logo.md) |
| Color palette | [../visual/color.md](../visual/color.md) |
| Typography | [../visual/typography.md](../visual/typography.md) |
| Layout, breakpoints | [layout.md](layout.md) |
| CSS tokens | [tokens.md](tokens.md) |
| Components | [components.md](components.md) |

---

## Implementation Notes

### Technology Preferences

Prefer native browser features over libraries:

- CSS transitions over JS animation libraries
- HTML `<dialog>` over modal libraries
- CSS Grid/Flexbox over layout frameworks
- Vanilla JS over frameworks for simple interactions

When frameworks are needed: stability over novelty, prioritize bundle size, ensure graceful degradation.

### Performance Budget

- First paint: < 1 second
- Interactive: < 2 seconds
- Total page weight: < 500KB
- Largest image: < 100KB

Speed is the feature. Slow = broken.

### Code Source

Product implementation: `shareout-app/src/design-system/`

---

## Design North Star

Ideas deserve to exist. ShareOut makes that possible.

If a design makes creation feel harder, publishing feel intimidating, or possibility feel smaller — it is wrong.

---

*This overview replaces the monolithic `design_system.md`. Brand/visual content is canonical in `../brand/` and `../visual/`.*
