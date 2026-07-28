# Design choice — pick the visual language

Looks are a deliberate decision, separate from structure. The default for AI-built pages is "templated and generic" — this file is how you avoid that. It's a *selector*: pick one of three paths, then go deep in [../modules/ui/taste.md](../modules/ui/taste.md), the canonical design reference. Don't duplicate taste rules here — link to them.

**One principle above all: taste is restraint.** Fewer colors, fewer fonts, fewer effects, more whitespace, one clear action.

## Set the design read first

Before choosing a path, state one line: **page kind / audience / vibe**. The audience picks the aesthetic, not your preference. Then commit to one level on three dials (full detail in [../modules/ui/taste.md](../modules/ui/taste.md#set-the-dials-before-you-build)):

- **Variance** — low for data tools, high for marketing/editorial.
- **Motion** — none for dashboards, subtle for most, expressive only for launch pages.
- **Density** — airy for marketing/mobile, tight for data-heavy tools.

## The three paths

### 1. ShareOut design system — the default

The fastest path to a good-looking artifact: don't write custom CSS, use the system. Link `shareout.css`, build with `.so-` classes. You inherit:

- Brand fonts already paired (Satoshi display, Source Sans 3 body, JetBrains Mono).
- A warm, light palette with blue used sparingly.
- Harmonized spacing (8px scale), radius, shadow, and an 8-color chart series.

Offer this every time. Reference: [../modules/ui/overview.md](../modules/ui/overview.md), [../modules/ui/classes.md](../modules/ui/classes.md), [../modules/ui/components.md](../modules/ui/components.md).

### 2. Workspace house style

If the user is on a Teams workspace with context files defining brand, voice, or CSS overrides, **use them** — they outrank the defaults. You should already have pulled these in step 1 of [overview.md](overview.md). Apply the workspace fonts, colors, and tone. Reference: [../team/workspace-context.md](../team/workspace-context.md).

### 3. Bespoke elevated look

When the user explicitly wants something distinctive — a marketing page, a client presentation, a brand moment — commit to a custom aesthetic. This is where the best of premium frontend practice applies, adapted to ShareOut's single-file, moderation-safe constraints:

- **Pick ONE aesthetic direction and execute it precisely** — e.g. editorial/magazine, refined minimal, warm organic, technical/mono. Both bold maximalism and refined minimalism work; the failure is *no* committed direction. Don't mix two languages in one page.
- **Massive type-scale contrast.** Oversized display headings (`clamp()` up to large viewport sizes) against crisp 16–18px body. Hierarchy from weight and color, not just size.
- **Distinctive fonts.** A real display/grotesque face paired with a refined body font. Fonts via a Google Fonts **stylesheet** are safe (only external *scripts* trip moderation). Never ship the AI-default stack (Inter, Roboto, Arial, Open Sans) as a deliberate choice.
- **Atmosphere over flat fills.** Subtle texture, soft gradient meshes (not purple), layered depth, grain at low opacity — to remove digital sterility. Keep it out of the reading path.
- **One accent, used sparingly.** Override the `--so-*` tokens in a `:root` block to retheme; keep a single accent and one gray family.
- **Override tokens, don't abandon the system.** Even a bespoke look should retheme `--so-*` variables rather than hardcode hex everywhere — you keep spacing/shadow harmony for free.

Still respect the motion and performance rules in [stack.md](stack.md) — CSS-first, `transform`/`opacity` only, `prefers-reduced-motion` honored. Heavy animation libraries are opt-in with the moderation caveat ([stack.md](stack.md#elevated-motion-opt-in)).

## Anti-slop — never ship these

The tells that scream "auto-generated" (full ban list + pre-ship checklist in [../modules/ui/taste.md](../modules/ui/taste.md#anti-slop-ban-list)). The headlines:

- **No purple/neon glows or AI-gradient backgrounds** — the #1 fingerprint of a generated page.
- **No Inter/Roboto/Arial** as a deliberate default.
- **No three-equal-cards feature row** — vary the layout (zig-zag, asymmetric bento).
- **No AI marketing clichés** in copy ("Elevate", "Seamless", "Unleash", "Game-changer"). Write plainly.
- **No fake-perfect numbers** (`99.99%`, `$100.00`) — real data is uneven.
- **Icon + label always** on key actions; **one primary action per screen.**
- **No eyebrow spam / section numbers / decorative status dots / "scroll to explore" cues.**

## Module-specific depth

When building a specific type, also read its visual guide:

- Dashboards: [../modules/dashboards/design/](../modules/dashboards/design/)
- Slides: [../modules/slides/design/](../modules/slides/design/)
- Mobile/PWA: [../modules/mobile/design/](../modules/mobile/design/)

## Related

- [../modules/ui/taste.md](../modules/ui/taste.md) — the deep design reference (read this for anything visual)
- [../modules/ui/overview.md](../modules/ui/overview.md) — load the design system
- [stack.md](stack.md) — the architecture the visuals sit on
- [pre-ship.md](pre-ship.md) — design checks before publish
