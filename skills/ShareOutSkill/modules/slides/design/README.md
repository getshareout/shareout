# Slides Design Module

Visual design guidelines and best practices for creating professional presentations.

## Credits

This design module is based on [frontend-slides](https://github.com/zarazhangrui/frontend-slides) by **@zarazhangrui**.

Adapted and integrated into ShareOut with permission. Original work provides foundational design principles for modern web presentations.

---

## How Claude Uses This

When users create presentations, Claude references these guidelines to:

1. **Choose appropriate layouts** based on content type
2. **Select color palettes** that work together
3. **Apply typography** with proper hierarchy
4. **Structure slides** for visual impact
5. **Follow accessibility** best practices

---

## Contents

| File | Purpose |
|------|---------|
| [principles.md](principles.md) | Core visual design principles |
| [typography.md](typography.md) | Font selection and hierarchy |
| [colors.md](colors.md) | Color palettes and accessibility |
| [layouts.md](layouts.md) | Common slide layout patterns |
| [templates.md](templates.md) | Ready-to-use starter templates |

---

## Quick Reference

### The 6:3:1 Rule

- **60%** dominant color (background)
- **30%** secondary color (content areas)
- **10%** accent color (highlights, CTAs)

### Slide Density

- **Title slides:** 1 idea, minimal text
- **Content slides:** Max 6 bullet points
- **Data slides:** 1 visualization + key insight

### Typography Scale

```
Title:    48-72px
Heading:  36-48px
Subhead:  24-32px
Body:     18-24px
Caption:  14-16px
```

### Font Pairings

| Heading | Body | Vibe |
|---------|------|------|
| Inter | Inter | Clean, modern |
| Playfair Display | Source Sans Pro | Elegant |
| Montserrat | Open Sans | Professional |
| Space Grotesk | IBM Plex Sans | Technical |

---

## Usage in ShareOut

When building presentations, apply these guidelines:

```javascript
// Set presentation theme using design principles
presentation.meta.set({
  defaultFont: {
    heading: 'Inter',
    body: 'Inter',
    mono: 'JetBrains Mono'
  },
  defaultColors: {
    background: '#0f172a',  // Dark slate
    text: '#f8fafc',        // Almost white
    accent: '#3b82f6'       // Blue accent (10%)
  }
});

// Each slide follows layout patterns
presentation.slides.setContent('slide-1', `
  <div class="title-slide" style="
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: 100%;
    text-align: center;
  ">
    <h1 style="font-size: 64px; margin-bottom: 24px;">
      Quarterly Review
    </h1>
    <p style="font-size: 24px; color: #94a3b8;">
      Q4 2026 Results
    </p>
  </div>
`);
```

---

## Design Principles Summary

1. **Less is more** - Remove everything unnecessary
2. **Consistency** - Same spacing, colors, fonts throughout
3. **Hierarchy** - Clear visual importance levels
4. **Contrast** - Ensure readability
5. **Alignment** - Use grids, avoid random placement
6. **White space** - Let content breathe

---

## License

Original [frontend-slides](https://github.com/zarazhangrui/frontend-slides) by @zarazhangrui.
Integrated into ShareOut Skill for presentation design guidance.
