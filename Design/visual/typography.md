# Typography

## Philosophy

Readable first. Beautiful second. Trendy last.

**Two font families maximum** — one display, one body.

---

## Font Stacks

| Role | Typeface | Fallback stack |
|------|----------|----------------|
| Display | Satoshi or Instrument Sans | `'Instrument Sans', 'Avenir Next', system-ui, sans-serif` |
| Body | Source Sans 3 | `'Source Sans 3', 'Segoe UI', system-ui, sans-serif` |
| Mono | JetBrains Mono | `'JetBrains Mono', 'SF Mono', monospace` |

### Display — used for

Headlines · Marketing · Hero sections · Card titles · Page titles

Distinctive but readable. Character without chaos. **Not** Inter, Roboto, or generic geometric sans.

### Body — used for

Product UI · Documentation · Interfaces · Default text

Extremely legible. Minimum 16px. Generous line-height (1.5+). **Not** thin weights or low contrast.

### Mono — used for

URLs · Code · Technical content · Metadata (URLs in lists)

---

## Scale

| Token | Size | Weight | Line Height | Use |
|-------|------|--------|-------------|-----|
| Hero / `--text-4xl` | 36px | 700 | 1.1 | Landing headlines |
| `--text-3xl` | 30px | 700 | 1.2 | Page titles |
| `--text-2xl` | 24px | 600 | 1.3 | Section headers |
| `--text-xl` | 20px | 600 | 1.4 | Card titles |
| `--text-lg` | 18px | 500 | 1.5 | Emphasized body |
| Body / `--text-base` | 16px | 400 | 1.6 | Default text |
| `--text-sm` | 14px | 400 | 1.5 | Secondary text |
| Caption / `--text-xs` | 12–13px | 400 | 1.5 | Hints, metadata |

---

## Craft details

Small settings that separate considered type from default type.

- **Tracking:** tighten large display type, open up small caps.
  - Headlines (24px+): `letter-spacing: -0.02em` (down to `-0.03em` at hero scale).
  - Body: `0` (default).
  - Small uppercase labels / eyebrows: `letter-spacing: 0.06em`.
- **Tabular numerals for data.** Any aligned numbers (tables, metrics, prices, counters) use `font-variant-numeric: tabular-nums` so columns line up and digits don't jitter when they change.
- **Kill orphans.** Headlines use `text-wrap: balance`; body paragraphs use `text-wrap: pretty`. A single word stranded on its own line is a layout bug.
- **Measure cap.** Body copy never exceeds **~65 characters** per line (`max-width: 65ch`). Long lines lose the reader's place.

---

## Implementation

```css
:root {
  --font-display: 'Instrument Sans', 'Avenir Next', system-ui, sans-serif;
  --font-body: 'Source Sans 3', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', monospace;
}

h1 { font: 700 36px/1.1 var(--font-display); letter-spacing: -0.025em; text-wrap: balance; }
h2 { font: 600 30px/1.2 var(--font-display); letter-spacing: -0.02em; text-wrap: balance; }
h3 { font: 600 24px/1.3 var(--font-display); letter-spacing: -0.02em; }
p  { font: 400 16px/1.6 var(--font-body); max-width: 65ch; text-wrap: pretty; }

.numeric { font-variant-numeric: tabular-nums; }   /* tables, metrics, prices */
```

---

*See also: [../system/tokens.md](../system/tokens.md)*
