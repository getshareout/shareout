# Typography

Font selection, pairing, and hierarchy for presentations.

## Font Categories

### Sans-Serif (Modern, Clean)

Best for: Most presentations, tech, startups

| Font | Weight | Use Case |
|------|--------|----------|
| Inter | 400, 600, 700 | Universal, highly readable |
| Poppins | 500, 700 | Friendly, approachable |
| Montserrat | 500, 700 | Professional, geometric |
| Space Grotesk | 500, 700 | Technical, modern |
| DM Sans | 400, 700 | Clean, contemporary |

### Serif (Classic, Elegant)

Best for: Executive presentations, traditional industries

| Font | Weight | Use Case |
|------|--------|----------|
| Playfair Display | 700 | Headlines only, elegant |
| Lora | 400, 700 | Body-friendly serif |
| Source Serif Pro | 400, 700 | Professional docs |
| Merriweather | 400, 700 | Long-form reading |

### Mono (Code, Technical)

Best for: Code slides, technical content

| Font | Use Case |
|------|----------|
| JetBrains Mono | Code blocks |
| Fira Code | Code with ligatures |
| IBM Plex Mono | Clean, readable |
| Source Code Pro | Standard choice |

---

## Font Pairings

### Modern Professional

```css
--font-heading: 'Inter', sans-serif;
--font-body: 'Inter', sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

One font family, vary weights for hierarchy.

### Elegant Executive

```css
--font-heading: 'Playfair Display', serif;
--font-body: 'Source Sans Pro', sans-serif;
--font-mono: 'Source Code Pro', monospace;
```

Serif headlines create authority, sans-serif body for readability.

### Technical/Developer

```css
--font-heading: 'Space Grotesk', sans-serif;
--font-body: 'IBM Plex Sans', sans-serif;
--font-mono: 'IBM Plex Mono', monospace;
```

Geometric, technical feel.

### Friendly/Startup

```css
--font-heading: 'Poppins', sans-serif;
--font-body: 'DM Sans', sans-serif;
--font-mono: 'Fira Code', monospace;
```

Approachable, modern.

---

## Type Scale

Use consistent ratios for size progression.

### Recommended Scale (1920x1080)

```
Title:     64-72px  (presentation title)
Heading 1: 48px     (slide title)
Heading 2: 36px     (section heading)
Heading 3: 28px     (subsection)
Body:      20-24px  (main text)
Small:     16-18px  (captions, labels)
Tiny:      14px     (footnotes)
```

### Ratio: Major Third (1.25)

```
72px → 58px → 46px → 37px → 30px → 24px → 19px
```

Each step is previous / 1.25.

---

## Line Height

Space between lines of text.

### Guidelines

| Content | Line Height |
|---------|-------------|
| Headlines (single line) | 1.1 - 1.2 |
| Short paragraphs | 1.4 - 1.5 |
| Long body text | 1.6 - 1.8 |
| Bullet lists | 1.5 |

### Example

```css
h1 { line-height: 1.1; }
p { line-height: 1.6; }
li { line-height: 1.5; }
```

---

## Letter Spacing

### Headlines

Slight tightening for large text:

```css
h1 {
  letter-spacing: -0.02em;  /* Tighter */
}
```

### Body

Default or slight loosening:

```css
p {
  letter-spacing: 0;  /* Normal */
}

.small-caps {
  letter-spacing: 0.05em;  /* Looser for caps */
}
```

### All Caps

Always add letter spacing:

```css
.label {
  text-transform: uppercase;
  letter-spacing: 0.1em;  /* Required for readability */
}
```

---

## Font Weights

### Usage

| Weight | Name | Use |
|--------|------|-----|
| 400 | Regular | Body text |
| 500 | Medium | Emphasis, subheads |
| 600 | Semibold | Strong emphasis |
| 700 | Bold | Headlines, key points |

### Don't Overuse Bold

```
❌ BAD:
**Everything** is **bold** and **nothing** stands out.

✓ GOOD:
Regular text with **one key point** emphasized.
```

---

## Hierarchy Example

```html
<style>
  .title { font-size: 64px; font-weight: 700; line-height: 1.1; }
  .subtitle { font-size: 28px; font-weight: 400; color: #94a3b8; }
  .heading { font-size: 36px; font-weight: 600; margin-bottom: 24px; }
  .body { font-size: 20px; line-height: 1.6; }
  .label { font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; }
</style>

<h1 class="title">Quarterly Results</h1>
<p class="subtitle">Q4 2026 Financial Summary</p>

<h2 class="heading">Revenue Growth</h2>
<p class="body">We achieved significant growth this quarter...</p>

<span class="label">Year over Year</span>
```

---

## Readability Rules

### Minimum Sizes

For 1920x1080 viewed on screen:

| Element | Min Size |
|---------|----------|
| Body text | 18px |
| Labels | 14px |
| Headlines | 36px |

For projected presentations, increase by 20%.

### Line Length

Optimal: 45-75 characters per line

```
Too wide (hard to track):
The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps.

Just right:
The quick brown fox jumps over the lazy dog.
The quick brown fox jumps over the lazy dog.
```

### Contrast

Dark text on light: Use #1e293b (not pure black)
Light text on dark: Use #f8fafc (not pure white)

---

## Loading Web Fonts

### Google Fonts

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
```

### Performance Tips

1. Only load weights you use
2. Use `display=swap` for fast render
3. Preconnect to font servers
4. Consider system fonts for speed

### System Font Stack

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
             'Helvetica Neue', Arial, sans-serif;
```

---

## CSS Variables for Typography

```css
:root {
  /* Font families */
  --font-heading: 'Inter', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Font sizes */
  --text-title: 64px;
  --text-h1: 48px;
  --text-h2: 36px;
  --text-h3: 28px;
  --text-body: 20px;
  --text-small: 16px;
  --text-tiny: 14px;

  /* Line heights */
  --leading-tight: 1.1;
  --leading-normal: 1.5;
  --leading-relaxed: 1.8;

  /* Font weights */
  --weight-normal: 400;
  --weight-medium: 500;
  --weight-bold: 700;
}
```
