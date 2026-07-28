# Colors

Color palettes, accessibility, and usage guidelines.

## The 60-30-10 Rule

Balance colors for visual harmony:

```
┌────────────────────────────────────────┐
│████████████████████████████████████████│ 60% - Dominant (background)
│████████████████████████████████████████│
│████████████████████████████████████████│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓               │ 30% - Secondary (surfaces)
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓               │
│░░░░░░░░░░                              │ 10% - Accent (highlights)
└────────────────────────────────────────┘
```

---

## Color Palettes

### Dark Mode (Recommended)

Better for projected presentations and screens.

```css
:root {
  --bg-primary: #0f172a;      /* Slate 900 - main background */
  --bg-secondary: #1e293b;    /* Slate 800 - cards, surfaces */
  --bg-tertiary: #334155;     /* Slate 700 - hover states */

  --text-primary: #f8fafc;    /* Slate 50 - main text */
  --text-secondary: #94a3b8;  /* Slate 400 - muted text */
  --text-tertiary: #64748b;   /* Slate 500 - subtle text */

  --accent: #3b82f6;          /* Blue 500 - primary action */
  --accent-hover: #60a5fa;    /* Blue 400 - hover */

  --success: #22c55e;         /* Green 500 */
  --warning: #f59e0b;         /* Amber 500 */
  --error: #ef4444;           /* Red 500 */
}
```

### Light Mode

For printed materials or bright environments.

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f8fafc;
  --bg-tertiary: #f1f5f9;

  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-tertiary: #94a3b8;

  --accent: #2563eb;
  --accent-hover: #1d4ed8;
}
```

### Minimal (High Contrast)

Maximum readability.

```css
:root {
  --bg-primary: #000000;
  --text-primary: #ffffff;
  --accent: #ffffff;
}
```

---

## Accent Color Variations

### Blue (Professional, Trust)

```css
--accent: #3b82f6;
```
Best for: Corporate, tech, finance

### Green (Growth, Success)

```css
--accent: #22c55e;
```
Best for: Sustainability, health, positive results

### Purple (Innovation, Creativity)

```css
--accent: #8b5cf6;
```
Best for: Creative industries, luxury

### Orange (Energy, Urgency)

```css
--accent: #f97316;
```
Best for: Calls to action, startups

### Teal (Modern, Fresh)

```css
--accent: #14b8a6;
```
Best for: Modern brands, health tech

---

## Accessibility

### Contrast Ratios

WCAG 2.1 requirements:

| Level | Normal Text | Large Text |
|-------|-------------|------------|
| AA | 4.5:1 | 3:1 |
| AAA | 7:1 | 4.5:1 |

Large text = 24px+ regular or 18.5px+ bold

### Checking Contrast

```
✓ PASS: White (#f8fafc) on Dark (#1e293b) = 12.6:1
✓ PASS: Slate 400 (#94a3b8) on Dark (#0f172a) = 5.4:1
✗ FAIL: Slate 500 (#64748b) on Dark (#1e293b) = 3.2:1
```

Use: https://webaim.org/resources/contrastchecker/

### Color Blindness

Don't rely on color alone:

```
❌ BAD:  Red items are errors, green items are success
✓ GOOD: Red items with ✗ icon, green items with ✓ icon
```

Test with: https://www.color-blindness.com/coblis-color-blindness-simulator/

---

## Gradients

### Subtle Background

```css
background: linear-gradient(
  135deg,
  #0f172a 0%,
  #1e293b 100%
);
```

### Accent Gradient

```css
background: linear-gradient(
  90deg,
  #3b82f6 0%,
  #8b5cf6 100%
);
```

### Usage Rules

1. Keep gradients subtle (close colors)
2. Don't put text on complex gradients
3. Use for backgrounds, not text
4. Test on target display

---

## Semantic Colors

### Status Colors

```css
--success: #22c55e;  /* Positive: growth, completed */
--warning: #f59e0b;  /* Caution: pending, attention */
--error: #ef4444;    /* Negative: decline, failed */
--info: #3b82f6;     /* Neutral: information */
```

### Usage

```html
<span style="color: var(--success)">+15%</span>
<span style="color: var(--error)">-8%</span>
```

---

## Data Visualization Colors

### Sequential (Single Variable)

```css
/* Light to dark */
--data-1: #dbeafe;  /* Lightest */
--data-2: #93c5fd;
--data-3: #60a5fa;
--data-4: #3b82f6;
--data-5: #1d4ed8;  /* Darkest */
```

### Categorical (Multiple Categories)

```css
/* Distinct, balanced colors */
--cat-1: #3b82f6;  /* Blue */
--cat-2: #22c55e;  /* Green */
--cat-3: #f59e0b;  /* Amber */
--cat-4: #8b5cf6;  /* Purple */
--cat-5: #ef4444;  /* Red */
--cat-6: #06b6d4;  /* Cyan */
```

### Diverging (Positive/Negative)

```css
/* Red ← Neutral → Green */
--neg-2: #ef4444;  /* Strong negative */
--neg-1: #f87171;  /* Mild negative */
--neutral: #94a3b8;
--pos-1: #4ade80;  /* Mild positive */
--pos-2: #22c55e;  /* Strong positive */
```

---

## Image Overlays

### Dark Overlay for Text

```css
.slide-with-image {
  background-image: url('...');
  position: relative;
}

.slide-with-image::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(15, 23, 42, 0.7),
    rgba(15, 23, 42, 0.9)
  );
}
```

### Tinted Overlay

```css
.slide-with-image::before {
  background: rgba(59, 130, 246, 0.5);  /* Blue tint */
}
```

---

## CSS Variables Template

```css
:root {
  /* Backgrounds */
  --color-bg-primary: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-bg-tertiary: #334155;

  /* Text */
  --color-text-primary: #f8fafc;
  --color-text-secondary: #94a3b8;
  --color-text-tertiary: #64748b;

  /* Accent */
  --color-accent: #3b82f6;
  --color-accent-hover: #60a5fa;
  --color-accent-muted: rgba(59, 130, 246, 0.2);

  /* Status */
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-error: #ef4444;

  /* Borders */
  --color-border: #334155;
  --color-border-light: rgba(255, 255, 255, 0.1);
}
```

---

## Quick Tips

1. **Test on projector** - Colors look different
2. **Use opacity** for subtle variations
3. **Avoid pure black/white** - Too harsh
4. **Limit palette** - 3-5 colors max
5. **Be consistent** - Same colors same meaning
