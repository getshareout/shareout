# Templates

Ready-to-use presentation templates.

## Dark Professional

Modern, clean, corporate-friendly.

### Theme

```javascript
presentation.meta.set({
  dimensions: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  defaultFont: {
    heading: 'Inter',
    body: 'Inter',
    mono: 'JetBrains Mono'
  },
  defaultColors: {
    background: '#0f172a',
    text: '#f8fafc',
    accent: '#3b82f6'
  }
});
```

### CSS Variables

```css
:root {
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --accent: #3b82f6;
}
```

### Best For

- Tech companies
- Investor decks
- Product launches
- Internal reviews

---

## Light Minimal

Clean, airy, professional.

### Theme

```javascript
presentation.meta.set({
  dimensions: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  defaultFont: {
    heading: 'Inter',
    body: 'Inter',
    mono: 'SF Mono'
  },
  defaultColors: {
    background: '#ffffff',
    text: '#1e293b',
    accent: '#2563eb'
  }
});
```

### CSS Variables

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f8fafc;
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --accent: #2563eb;
}
```

### Best For

- Formal presentations
- Academic content
- Print-friendly
- Bright environments

---

## Startup/Pitch Deck

Bold, energetic, attention-grabbing.

### Theme

```javascript
presentation.meta.set({
  dimensions: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  defaultFont: {
    heading: 'Poppins',
    body: 'DM Sans',
    mono: 'Fira Code'
  },
  defaultColors: {
    background: '#18181b',
    text: '#fafafa',
    accent: '#f97316'
  }
});
```

### CSS Variables

```css
:root {
  --bg-primary: #18181b;
  --bg-secondary: #27272a;
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --accent: #f97316;
  --accent-gradient: linear-gradient(135deg, #f97316, #fb923c);
}
```

### Best For

- Pitch decks
- Startup presentations
- Marketing content
- Demo days

---

## Executive/Board

Elegant, serious, trustworthy.

### Theme

```javascript
presentation.meta.set({
  dimensions: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  defaultFont: {
    heading: 'Playfair Display',
    body: 'Source Sans Pro',
    mono: 'Source Code Pro'
  },
  defaultColors: {
    background: '#1a1a2e',
    text: '#eaeaea',
    accent: '#c9a227'
  }
});
```

### CSS Variables

```css
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --text-primary: #eaeaea;
  --text-secondary: #b8b8b8;
  --accent: #c9a227;
}
```

### Best For

- Board meetings
- Executive summaries
- Financial reports
- Annual reviews

---

## Technical/Developer

Clean, functional, code-friendly.

### Theme

```javascript
presentation.meta.set({
  dimensions: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  defaultFont: {
    heading: 'Space Grotesk',
    body: 'IBM Plex Sans',
    mono: 'JetBrains Mono'
  },
  defaultColors: {
    background: '#1e1e2e',
    text: '#cdd6f4',
    accent: '#89b4fa'
  }
});
```

### CSS Variables

```css
:root {
  /* Catppuccin Mocha */
  --bg-primary: #1e1e2e;
  --bg-secondary: #313244;
  --text-primary: #cdd6f4;
  --text-secondary: #a6adc8;
  --accent: #89b4fa;
  --code-bg: #313244;
  --code-text: #a6e3a1;
}
```

### Best For

- Technical talks
- API documentation
- Developer conferences
- Architecture reviews

---

## Creative/Design

Bold colors, expressive typography.

### Theme

```javascript
presentation.meta.set({
  dimensions: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  defaultFont: {
    heading: 'Space Grotesk',
    body: 'DM Sans',
    mono: 'Fira Code'
  },
  defaultColors: {
    background: '#0d0d0d',
    text: '#ffffff',
    accent: '#ff3366'
  }
});
```

### CSS Variables

```css
:root {
  --bg-primary: #0d0d0d;
  --bg-secondary: #1a1a1a;
  --text-primary: #ffffff;
  --text-secondary: #999999;
  --accent: #ff3366;
  --accent-2: #33ccff;
  --gradient: linear-gradient(135deg, #ff3366, #33ccff);
}
```

### Best For

- Creative portfolios
- Design presentations
- Brand pitches
- Marketing campaigns

---

## Template Starter Code

### Full HTML Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920, height=1080">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --accent: #3b82f6;
    }

    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
    }

    .slide {
      width: 1920px;
      height: 1080px;
      padding: 48px;
    }

    h1 { font-size: 64px; font-weight: 700; }
    h2 { font-size: 40px; font-weight: 600; }
    p { font-size: 24px; line-height: 1.6; }

    .muted { color: var(--text-secondary); }
    .accent { color: var(--accent); }
    .centered { display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; height: 100%; }
  </style>
</head>
<body>
  <div class="slide centered">
    <h1>Presentation Title</h1>
    <p class="muted" style="margin-top: 24px;">Subtitle</p>
  </div>
</body>
</html>
```

---

## Applying Templates

```javascript
// Create with template
const presentation = await sdk.slides.create({
  title: 'My Presentation',
  template: 'dark-professional'
});

// Or apply to existing
presentation.meta.set({
  defaultFont: templates['dark-professional'].font,
  defaultColors: templates['dark-professional'].colors
});
```

---

## Custom Templates

Save your own:

```javascript
// Extract current theme as template
const myTemplate = {
  name: 'My Company Theme',
  font: presentation.meta.get().defaultFont,
  colors: presentation.meta.get().defaultColors,
  css: `
    .logo { position: absolute; top: 24px; right: 24px; width: 120px; }
    .footer { position: absolute; bottom: 24px; font-size: 14px; }
  `
};

// Save to json store
await sdk.json.set('custom-template', myTemplate);
```
