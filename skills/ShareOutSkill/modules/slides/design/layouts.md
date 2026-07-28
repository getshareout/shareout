# Slide Layouts

Common layout patterns for different content types.

## Title Slide

First impression. Keep it minimal.

```
┌────────────────────────────────────────┐
│                                        │
│                                        │
│                                        │
│           PRESENTATION TITLE           │
│             Subtitle here              │
│                                        │
│                                        │
│         Author • Date • Company        │
│                                        │
└────────────────────────────────────────┘
```

### HTML

```html
<div style="
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  text-align: center;
  padding: 48px;
">
  <h1 style="font-size: 64px; font-weight: 700; margin-bottom: 16px;">
    Presentation Title
  </h1>
  <p style="font-size: 24px; color: var(--text-secondary); margin-bottom: 48px;">
    Subtitle or tagline
  </p>
  <p style="font-size: 16px; color: var(--text-tertiary);">
    Author Name • October 2026 • Company
  </p>
</div>
```

---

## Section Divider

Mark major sections. Creates rhythm.

```
┌────────────────────────────────────────┐
│                                        │
│  01                                    │
│                                        │
│  SECTION                               │
│  TITLE                                 │
│                                        │
│  Brief description of this section     │
│                                        │
└────────────────────────────────────────┘
```

### HTML

```html
<div style="
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
  padding: 80px;
">
  <span style="
    font-size: 72px;
    font-weight: 700;
    color: var(--accent);
    opacity: 0.3;
    margin-bottom: 24px;
  ">01</span>
  <h1 style="font-size: 56px; font-weight: 700; margin-bottom: 16px;">
    Section Title
  </h1>
  <p style="font-size: 20px; color: var(--text-secondary); max-width: 600px;">
    Brief description of what this section covers
  </p>
</div>
```

---

## Title + Content

Most common layout. Title anchors content.

```
┌────────────────────────────────────────┐
│  Slide Title                           │
│                                        │
│  • First point                         │
│  • Second point                        │
│  • Third point                         │
│  • Fourth point                        │
│                                        │
│                                        │
└────────────────────────────────────────┘
```

### HTML

```html
<div style="padding: 48px;">
  <h2 style="font-size: 40px; font-weight: 700; margin-bottom: 32px;">
    Slide Title
  </h2>
  <ul style="font-size: 24px; line-height: 1.8; list-style: disc; padding-left: 32px;">
    <li>First key point</li>
    <li>Second key point</li>
    <li>Third key point</li>
    <li>Fourth key point</li>
  </ul>
</div>
```

---

## Two Column

Compare, contrast, or show before/after.

```
┌────────────────────────────────────────┐
│  Slide Title                           │
│                                        │
│  ┌─────────────┐    ┌─────────────┐   │
│  │  Column 1   │    │  Column 2   │   │
│  │             │    │             │   │
│  │  Content    │    │  Content    │   │
│  │             │    │             │   │
│  └─────────────┘    └─────────────┘   │
│                                        │
└────────────────────────────────────────┘
```

### HTML

```html
<div style="padding: 48px;">
  <h2 style="font-size: 40px; font-weight: 700; margin-bottom: 32px;">
    Slide Title
  </h2>
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 48px;">
    <div>
      <h3 style="font-size: 24px; margin-bottom: 16px; color: var(--accent);">
        Column 1
      </h3>
      <p style="font-size: 20px; line-height: 1.6;">
        Content for the first column
      </p>
    </div>
    <div>
      <h3 style="font-size: 24px; margin-bottom: 16px; color: var(--accent);">
        Column 2
      </h3>
      <p style="font-size: 20px; line-height: 1.6;">
        Content for the second column
      </p>
    </div>
  </div>
</div>
```

---

## Image + Text

Visual with supporting explanation.

```
┌────────────────────────────────────────┐
│  ┌──────────────┐  Title               │
│  │              │                      │
│  │    IMAGE     │  Description text    │
│  │              │  that explains the   │
│  │              │  visual content.     │
│  └──────────────┘                      │
│                                        │
└────────────────────────────────────────┘
```

### HTML

```html
<div style="
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  height: 100%;
  align-items: center;
  padding: 48px;
">
  <img src="..." style="
    width: 100%;
    border-radius: 12px;
    box-shadow: 0 25px 50px rgba(0,0,0,0.3);
  ">
  <div>
    <h2 style="font-size: 36px; font-weight: 700; margin-bottom: 24px;">
      Slide Title
    </h2>
    <p style="font-size: 20px; line-height: 1.8; color: var(--text-secondary);">
      Description text that explains the visual content
      and provides context for the audience.
    </p>
  </div>
</div>
```

---

## Full Image

Let visuals speak.

```
┌────────────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓ IMAGE ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│                      Caption (optional)│
└────────────────────────────────────────┘
```

### HTML

```html
<div style="
  height: 100%;
  background-image: url('...');
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: flex-end;
  padding: 48px;
">
  <p style="
    font-size: 16px;
    color: white;
    background: rgba(0,0,0,0.5);
    padding: 8px 16px;
    border-radius: 4px;
  ">
    Photo caption or credit
  </p>
</div>
```

---

## Big Number

Highlight key statistic.

```
┌────────────────────────────────────────┐
│                                        │
│                                        │
│             +47%                       │
│                                        │
│    Revenue growth year over year       │
│                                        │
│                                        │
└────────────────────────────────────────┘
```

### HTML

```html
<div style="
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  text-align: center;
">
  <span style="
    font-size: 144px;
    font-weight: 700;
    color: var(--accent);
    line-height: 1;
  ">+47%</span>
  <p style="
    font-size: 24px;
    color: var(--text-secondary);
    margin-top: 24px;
  ">
    Revenue growth year over year
  </p>
</div>
```

---

## Quote

Testimonial or key insight.

```
┌────────────────────────────────────────┐
│                                        │
│                                        │
│     "This changed everything           │
│      about how we work."               │
│                                        │
│                   — Sarah Chen, CEO    │
│                                        │
│                                        │
└────────────────────────────────────────┘
```

### HTML

```html
<div style="
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  text-align: center;
  padding: 80px;
">
  <blockquote style="
    font-size: 36px;
    font-style: italic;
    line-height: 1.6;
    max-width: 800px;
    margin-bottom: 32px;
  ">
    "This changed everything about how we work."
  </blockquote>
  <cite style="
    font-size: 18px;
    color: var(--text-secondary);
  ">
    — Sarah Chen, CEO of Acme Corp
  </cite>
</div>
```

---

## Three Cards

Features, options, or steps.

```
┌────────────────────────────────────────┐
│  Title                                 │
│                                        │
│  ┌────────┐  ┌────────┐  ┌────────┐   │
│  │ Card 1 │  │ Card 2 │  │ Card 3 │   │
│  │        │  │        │  │        │   │
│  │  Desc  │  │  Desc  │  │  Desc  │   │
│  └────────┘  └────────┘  └────────┘   │
│                                        │
└────────────────────────────────────────┘
```

### HTML

```html
<div style="padding: 48px;">
  <h2 style="font-size: 40px; font-weight: 700; margin-bottom: 48px; text-align: center;">
    Our Approach
  </h2>
  <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px;">
    <div style="
      background: var(--bg-secondary);
      padding: 32px;
      border-radius: 12px;
      text-align: center;
    ">
      <div style="font-size: 48px; margin-bottom: 16px;">🎯</div>
      <h3 style="font-size: 24px; margin-bottom: 12px;">Focus</h3>
      <p style="font-size: 16px; color: var(--text-secondary);">
        Description of this feature or step
      </p>
    </div>
    <!-- Repeat for cards 2 and 3 -->
  </div>
</div>
```

---

## Data/Chart

Visualization with context.

```
┌────────────────────────────────────────┐
│  Title                                 │
│                                        │
│  ┌────────────────────────────────┐   │
│  │                                │   │
│  │         CHART/GRAPH            │   │
│  │                                │   │
│  └────────────────────────────────┘   │
│                                        │
│  Key insight: Revenue up 23% in Q4     │
└────────────────────────────────────────┘
```

### HTML

```html
<div style="padding: 48px;">
  <h2 style="font-size: 36px; font-weight: 700; margin-bottom: 24px;">
    Quarterly Revenue
  </h2>
  <div style="height: 400px; margin-bottom: 24px;">
    <!-- Chart container - use ECharts, Chart.js, etc. -->
    <canvas id="chart"></canvas>
  </div>
  <p style="
    font-size: 20px;
    color: var(--accent);
    font-weight: 600;
  ">
    Key insight: Revenue increased 23% in Q4
  </p>
</div>
```

---

## Blank Canvas

Complete freedom for custom layouts.

```
┌────────────────────────────────────────┐
│                                        │
│                                        │
│         Your custom content            │
│         placed anywhere                │
│                                        │
│                                        │
└────────────────────────────────────────┘
```

Use absolute positioning for precise placement:

```html
<div style="position: relative; height: 100%;">
  <div style="position: absolute; top: 50px; left: 100px;">
    Element 1
  </div>
  <div style="position: absolute; bottom: 100px; right: 50px;">
    Element 2
  </div>
</div>
```

---

## Layout Mixins

### Centered Container

```css
.centered {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  text-align: center;
}
```

### Padded Container

```css
.padded {
  padding: 48px;
  box-sizing: border-box;
}
```

### Grid

```css
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; }
```
