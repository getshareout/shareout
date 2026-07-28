# Design Principles

Core visual principles for effective presentations.

## 1. Less Is More

Every element should earn its place.

### Do

- One idea per slide
- Remove filler words
- Use icons instead of text where possible
- Let images speak

### Don't

- Wall of text
- Multiple competing messages
- Decorative elements with no purpose
- Clip art or generic stock photos

### Example

```
❌ BAD: "We are pleased to announce that our Q4 revenue
        has increased by 15% compared to Q3, which represents
        a significant improvement in our market position."

✓ GOOD: "Q4 Revenue: +15%"
        [accompanied by chart visualization]
```

---

## 2. Visual Hierarchy

Guide the eye from most to least important.

### Size

Larger = more important

```
Title (64px)
  └── Heading (36px)
        └── Body (20px)
              └── Caption (14px)
```

### Color

Brighter/saturated = attention

```
Primary message: Accent color (bright)
Supporting info: Secondary color (muted)
Background: Neutral (dark/light)
```

### Position

Top-left gets attention first (Western reading pattern)

```
┌─────────────────────────────────┐
│ 1. KEY MESSAGE                  │
│                                 │
│    2. Supporting                │
│       details                   │
│                                 │
│              3. Reference ──────│
└─────────────────────────────────┘
```

---

## 3. Consistency

Same rules everywhere.

### Spacing

Pick a base unit, use multiples:

```
Base: 8px
Small:  8px
Medium: 16px
Large:  24px
XLarge: 48px
```

### Colors

3-5 colors maximum:

```
Background: #0f172a
Surface:    #1e293b
Text:       #f8fafc
Muted:      #94a3b8
Accent:     #3b82f6
```

### Fonts

2 fonts maximum:

```
Headings: Inter (bold)
Body:     Inter (regular)
```

---

## 4. Contrast

Text must be readable.

### Color Contrast

WCAG AA minimum: 4.5:1 for body text

```
✓ White (#ffffff) on Dark (#1e293b) = 12.6:1
✗ Gray (#94a3b8) on Dark (#1e293b) = 3.1:1 (fail)
```

### Size Contrast

Headings should be noticeably larger:

```
✓ Heading 48px, Body 20px (2.4x difference)
✗ Heading 24px, Body 20px (barely different)
```

---

## 5. Alignment

Nothing should float randomly.

### Grid System

Use invisible guidelines:

```
┌────────────────────────────────────────┐
│  ┌──────┐  ┌──────┐  ┌──────┐         │
│  │      │  │      │  │      │  margin │
│  └──────┘  └──────┘  └──────┘         │
│     ▲         ▲         ▲             │
│     └─────────┼─────────┘             │
│           aligned                      │
└────────────────────────────────────────┘
```

### Edge Alignment

Align edges, not centers (usually):

```
✓ Left edges aligned
┌──────────────────┐
│ Heading          │
│ Body text here   │
│ More text        │
└──────────────────┘

✗ Mixed alignment
     ┌──────────────────┐
     │      Heading     │
     │ Body text here   │
     │    More text     │
     └──────────────────┘
```

---

## 6. White Space

Empty space is not wasted space.

### Margins

```
┌────────────────────────────────────────┐
│                                        │
│     ┌────────────────────────┐         │
│     │                        │         │
│     │       Content          │         │
│     │                        │         │
│     └────────────────────────┘         │
│                                        │
└────────────────────────────────────────┘
     ▲                          ▲
     └── generous margins ──────┘
```

### Line Height

```
Too tight:
The quick brown fox jumps
over the lazy dog. This is
hard to read because lines
are cramped.

Just right (1.5-1.8x):
The quick brown fox jumps

over the lazy dog. This is

easier to read with space.
```

---

## 7. Focal Point

Every slide needs one.

### Where Does the Eye Go?

```
┌─────────────────────────────────┐
│                                 │
│                                 │
│         ████████████            │  ← Focal point
│         ██  KEY   ██            │    (size + color +
│         ████████████            │     position)
│                                 │
│    supporting text here         │
│                                 │
└─────────────────────────────────┘
```

### Creating Focus

1. Size (largest element)
2. Color (highest contrast)
3. Position (centered or top)
4. Isolation (space around it)

---

## 8. Repetition

Patterns create cohesion.

### Repeated Elements

- Same header style on all slides
- Consistent icon style
- Same transition between slides
- Logo in same position

### Visual Rhythm

```
Slide 1     Slide 2     Slide 3
┌─────┐     ┌─────┐     ┌─────┐
│ ▄▄▄ │     │ ▄▄▄ │     │ ▄▄▄ │  ← Header same
│     │     │     │     │     │
│     │     │     │     │     │
│    ●│     │    ●│     │    ●│  ← Indicator same
└─────┘     └─────┘     └─────┘
```

---

## Summary Checklist

Before each slide, ask:

- [ ] Is there ONE clear message?
- [ ] Is hierarchy obvious (what to read first)?
- [ ] Are colors/fonts consistent with other slides?
- [ ] Is text readable (contrast)?
- [ ] Are elements aligned to a grid?
- [ ] Is there enough white space?
- [ ] Is there a clear focal point?

---

## Resources

- [Refactoring UI](https://www.refactoringui.com/) - Design tips
- [Contrast Checker](https://webaim.org/resources/contrastchecker/) - WCAG validation
- [Type Scale](https://type-scale.com/) - Typography calculator
