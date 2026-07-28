# Artifact UI — design system as an SDK

The design system, shipped to published artifacts as a hosted stylesheet + behavior layer so artifacts get brand-correct UI with near-zero authored CSS.

This is the **artifact-facing** layer. It does not change how ShareOut's own pages/shell are built (those use `src/design-system/components.ts` server-side).

## What ships

| URL | Contents |
|-----|----------|
| `https://shareout.site/sdk/shareout.css` | Brand fonts (`@import`), tokens as `--so-*` CSS variables, a light classless base, and `.so-` component classes |
| `https://shareout.site/sdk/shareout-ui.js` | `window.ShareOutUI` — toast, modal, tabs, dropdown, copy, chartColors (vanilla, no deps) |

## Source of truth

- **Values** come from [`shareout-app/src/design-system/tokens.ts`](../../shareout-app/src/design-system/tokens.ts) — the same tokens the product shell uses. The stylesheet's `:root` block is **generated** by looping those tokens, so it can never drift. Adding/changing a token automatically flows to artifacts.
- **Class CSS** is authored in [`src/design-system/artifact-css.ts`](../../shareout-app/src/design-system/artifact-css.ts) and mirrors [components.md](components.md) (buttons, inputs, cards, badges, tables, stats) plus layout primitives and data-viz helpers.
- **Behavior** is authored in [`src/design-system/artifact-ui.ts`](../../shareout-app/src/design-system/artifact-ui.ts).

Served at runtime by `src/css-serve.ts` / `src/ui-serve.ts` (no build/embed step — the worker imports the TS directly). A sync test (`test/design-system/artifact-css.test.ts`) asserts every color token is emitted as a `--so-color-*` variable.

## Naming

All classes and variables are prefixed `so-` / `--so-` to avoid collisions with an author's own styles.

## Agent adoption

The ShareOut skill ([skills/ShareOutSkill/modules/ui/](../../skills/ShareOutSkill/modules/ui/overview.md)) instructs agents to link `shareout.css` and use `.so-` classes by default, and forbids inventing palettes, generic fonts, and purple/dark "AI" themes — see [anti_patterns.md](../principles/anti_patterns.md).
