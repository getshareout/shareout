# Color

## Philosophy

Blue is not decoration.

Blue is **intent**. Blue is **action**. Blue is **possibility**. Blue is **creation**.

- **One bold ownable blue** — used sparingly for primary actions and brand accent
- **Warm neutrals** — cream/stone backgrounds, warm black text — never cold blue-grays
- Feedback colors (success, error, warning) are functional — not brand colors

---

## Usage Ratio

**80% neutral · 15% white · 5% blue**

Blue should feel intentional. Never everywhere. The moment everything is blue, nothing is important.

---

## Primary Brand

| Name | Hex | Usage |
|------|-----|-------|
| ShareOut Blue | `#2563EB` | Primary buttons, active states, brand accent |
| Hover | `#1D4ED8` | Hover state for primary actions |
| Light | `#EFF6FF` | Focus rings, selected backgrounds |

---

## Neutrals (Warm)

| Name | Hex | Usage |
|------|-----|-------|
| Warm White / Background | `#FAFAF9` | Page canvas, app background |
| Surface | `#F5F5F4` | Input fields, cards, secondary areas |
| Elevated White | `#FFFFFF` | Toolbars, modals, dropdowns |
| Border | `#E7E5E4` | Dividers, input borders |
| Border Strong | `#D6D3D1` | Emphasized borders, hover states |

---

## Text (Warm)

| Name | Hex | Usage |
|------|-----|-------|
| Warm Black / Primary | `#1C1917` | Headlines, important text |
| Secondary / Stone | `#57534E` | Body text, icons |
| Tertiary | `#A8A29E` | Placeholders, hints, disabled |

---

## Feedback

| Name | Hex | Light bg |
|------|-----|----------|
| Success | `#16A34A` | `#F0FDF4` |
| Error | `#DC2626` | `#FEF2F2` |
| Warning | `#CA8A04` | `#FEFCE8` |

---

## Contrast (verified)

WCAG AA needs **4.5:1** for normal text, **3:1** for large text (18px+ or 14px bold) and UI borders. Approximate ratios for the palette on the warm-white canvas:

| Pair | Ratio (approx) | Verdict |
|------|----------------|---------|
| Warm Black `#1C1917` on `#FAFAF9` | ~16:1 | AAA ✓ |
| Secondary `#57534E` on `#FAFAF9` | ~7.3:1 | AAA ✓ |
| White on ShareOut Blue `#2563EB` | ~5.8:1 | AA ✓ (buttons, normal text) |
| Blue `#2563EB` on white | ~5.8:1 | AA ✓ (links) |
| **Tertiary `#A8A29E` on `#FAFAF9`** | ~2.4:1 | **Fails AA** — placeholders/disabled only, never readable content |
| Error `#DC2626` on white | ~4.0:1 | Large/bold or icons only |
| Success `#16A34A` on white | ~3.3:1 | Large/icons only |
| Warning `#CA8A04` on white | <3:1 | Icons/accents only |

**Rules that fall out of this:**
- Feedback colors (success/error/warning) are for borders, icons, and large/bold text. For small feedback text, use the dark warm-black on the `*-light` background instead.
- Never set body or essential text in Tertiary. It exists for hints, placeholders, and disabled states only.
- Verify any new text-on-color pairing against AA before shipping.

---

## Forbidden Colors

Purple gradients · Neon pink · Crypto aesthetics · AI startup gradients · Rainbow palettes

---

## CSS Tokens

```css
:root {
  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-primary-light: #eff6ff;

  --color-bg: #fafaf9;
  --color-bg-elevated: #ffffff;
  --color-surface: #f5f5f4;

  --color-text: #1c1917;
  --color-text-secondary: #57534e;
  --color-text-tertiary: #a8a29e;

  --color-border: #e7e5e4;
  --color-border-strong: #d6d3d1;

  --color-success: #16a34a;
  --color-success-light: #f0fdf4;
  --color-error: #dc2626;
  --color-error-light: #fef2f2;
  --color-warning: #ca8a04;
  --color-warning-light: #fefce8;
}
```

---

## Dark Mode (When Implemented)

```css
[data-theme="dark"] {
  --color-bg: #1c1917;
  --color-bg-elevated: #292524;
  --color-surface: #44403c;
  --color-text: #fafaf9;
  --color-text-secondary: #a8a29e;
  --color-text-tertiary: #78716c;
  --color-border: #44403c;
  --color-border-strong: #57534e;
}
```

### Protocol

Dark mode is one coherent theme, not an inverted afterthought.

- **Trigger:** respect `prefers-color-scheme: dark` by default. Add a manual toggle only if a user would plausibly want to override system preference. Set the theme once at the root (`[data-theme]` on `<html>`), never per-section.
- **No section flips.** The whole page is light or dark. A warm-cream section dropped into a dark page (or vice versa) reads as a different website mid-scroll.
- **No pure values.** Never `#000000` or `#ffffff` for surfaces or text. The warm-black/warm-white tokens above keep depth.
- **Hierarchy parity.** What pops in light pops in dark. The blue accent stays recognizable, never desaturated into the background.
- **Re-verify contrast** for every token pair in dark mode (the table above is the light-mode set).
- **Test in both modes before shipping.** Don't ship a screen you've only seen in one.

---

*See also: [../system/tokens.md](../system/tokens.md)*
