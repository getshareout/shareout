# Design Tokens

CSS custom properties for product implementation. Color tokens: [../visual/color.md](../visual/color.md). Typography: [../visual/typography.md](../visual/typography.md).

---

## Spacing Scale (8px base)

| Token | Value | Use |
|-------|-------|-----|
| `--space-1` | 4px | Tight gaps, icon padding |
| `--space-2` | 8px | Inline spacing |
| `--space-3` | 12px | Small component padding |
| `--space-4` | 16px | Standard padding |
| `--space-5` | 20px | Component gaps |
| `--space-6` | 24px | Section padding |
| `--space-8` | 32px | Large gaps |
| `--space-10` | 40px | Section margins |
| `--space-12` | 48px | Page sections |
| `--space-16` | 64px | Major sections |

Also: 96px · 128px for hero/marketing sections.

### Usage Pattern

```css
.card { padding: var(--space-6); }
.card + .card { margin-top: var(--space-8); }
section { padding: var(--space-12) 0; }
```

---

## Corner Radius

| Element | Radius |
|---------|--------|
| Small components / buttons | 12px |
| Inputs | 10px |
| Cards | 16px |
| Modals | 20px |
| Large surfaces / hero | 24px |
| Pills / badges | 50% or 26px |
| Icons / small | 6–8px |

---

## Shadows

Soft. Invisible. Never dramatic. Never floating cards everywhere.

Elevation should be felt, not seen.

**Tint shadows to the warm canvas, never pure black.** A `rgba(0,0,0,…)` shadow on a warm `#FAFAF9` background reads cold and dirty. Use the warm-black hue (`28, 25, 23` = `#1C1917`) at low alpha so shadows belong to the same world as the neutrals. Mirrors `shadows` in `packages/design-tokens/src/index.ts` → `--shadow-*`.

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-sm` | `0 1px 2px rgba(28,25,23,0.04)` | Cards, resting state |
| `--shadow-md` | `0 2px 8px rgba(28,25,23,0.06)` | Subtle elevation |
| `--shadow-lg` | `0 4px 16px rgba(28,25,23,0.08)` | Hover, dropdowns |
| `--shadow-xl` | `0 8px 24px rgba(28,25,23,0.1)` | Dialogs, overlays |

In dark mode, shadows do almost nothing. Lean on `--color-border` and surface lightness for elevation instead.

---

## Z-Index Scale

No arbitrary `z-50` or `z-[9999]`. Layers are systemic. Use the `zIndex` tokens from `packages/design-tokens/src/index.ts`.

| Token | Value | Layer |
|-------|-------|-------|
| `dropdown` | 100 | Dropdown menus |
| `sticky` | 200 | Sticky header, toolbar |
| `modal` | 300 | Modal, dialog, slide-over |
| `popover` | 400 | Popovers |
| `tooltip` | 500 | Tooltips |
| `toast` | 1000 | Toasts, transient alerts |

---

## Motion Tokens

Motion explains. Motion never decorates.

```css
:root {
  --duration-fast: 100ms;
  --duration-normal: 150ms;
  --duration-slow: 300ms;

  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
}
```

### When to animate (motion must be motivated)

Before adding any motion, name its job in one sentence. Valid jobs: **hierarchy** (draw the eye to the right thing), **feedback** (acknowledge a tap), **state transition** (show something changed), **guide attention** (reveal in narrative order). "It looked cool" is not a job. If you can't state the job, drop the animation.

- Animate **only `transform` and `opacity`.** Never `top`, `left`, `width`, `height` (they trigger layout, drop frames on mobile).
- `will-change: transform` only on elements that actually animate, never blanket.
- **Banned:** `window.addEventListener('scroll', …)` and scroll progress in JS state. Use `IntersectionObserver`, CSS scroll-driven animations (`animation-timeline: view()`), or a motion library's scroll hook. Per-frame scroll handlers jank and re-render the tree.

### Patterns

- Buttons: scale down slightly on press (0.98)
- Hover: subtle lift (-1px to -2px)
- Focus: ring appears (no jarring motion)
- Loading: skeleton first (matches final shape); spinner only for in-progress actions, never as the default content loader

### Entry Animations (use sparingly)

```css
@keyframes slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-in {
  animation: slide-up var(--duration-slow) var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .animate-in { animation: none; }
}
```

---

## Iconography

- **One library, project-wide.** Pick a single family and never mix. Recommended: [Phosphor](https://phosphoricons.com/) (Light/Regular), Radix Icons, or Tabler. All ship rounded, stroke-based glyphs that match the warm-but-capable tone.
- **Never hand-roll SVG icon paths.** If a glyph is missing, compose from the library or add one icon, don't draw from scratch.
- Avoid Lucide/Feather as a default (the generic AI-design tell); use only if a project already depends on it.
- Stroke-based, not filled
- 2px stroke weight, standardized across every icon
- Rounded caps and joins
- Consistent family throughout

| Context | Size |
|---------|------|
| Toolbar | 20px |
| In buttons | 18px |
| Inline | 16px |
| Large / decorative | 24px+ |

| State | Color |
|-------|-------|
| Default | `--color-text-secondary` |
| Hover | `--color-text` |
| Active | `--color-primary` |
| Disabled | `--color-text-tertiary` |

---

*See also: [../visual/color.md](../visual/color.md) · [components.md](components.md)*
