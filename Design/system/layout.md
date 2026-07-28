# Layout System

## Page Structure

```
┌─────────────────────────────────────────┐
│  Header (sticky, 64px)                  │
├─────────────────────────────────────────┤
│                                         │
│  Main Content                           │
│  (centered, max-width: 720px)           │
│  (padding: 24px sides)                  │
│                                         │
├─────────────────────────────────────────┤
│  Footer (minimal, only if needed)       │
└─────────────────────────────────────────┘
```

---

## Content Width

| Context | Max Width | Use Case |
|---------|-----------|----------|
| Reading | 720px | Text-heavy pages, forms |
| Dashboard | 1080px | Lists, galleries |
| Full | 100% | Landing hero, immersive |

---

## Grid

Simple, not clever:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
}
```

**Rule:** If you need more than 2 columns on mobile, you're doing too much.

---

## Breakpoints

| Name | Width | Behavior |
|------|-------|----------|
| Mobile | < 640px | Single column, stacked |
| Tablet | 640–1024px | Flexible, 2 columns max |
| Desktop | > 1024px | Full layout |

**Mobile-first always.** Desktop is enhancement, not default.

---

## Spacing Philosophy

Whitespace creates confidence. Crowded interfaces create anxiety.

When in doubt: add more space.

---

*See also: [tokens.md](tokens.md) · [components.md](components.md)*
