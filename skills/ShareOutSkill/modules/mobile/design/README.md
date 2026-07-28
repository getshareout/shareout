# Mobile Design Module

Visual design guidelines for creating native-feeling mobile experiences.

## How Claude Uses This

When users create mobile artifacts, Claude references these guidelines to:

1. **Choose navigation patterns** appropriate for the content type
2. **Design touch-friendly interfaces** with proper hit targets
3. **Apply platform conventions** (iOS/Android patterns)
4. **Optimize for thumb zones** and one-handed use
5. **Handle safe areas** (notches, home indicators)
6. **Create smooth animations** at 60fps

---

## Contents

| File | Purpose |
|------|---------|
| [principles.md](principles.md) | Mobile-first design principles |
| [touch.md](touch.md) | Touch targets, gestures, haptics |
| [navigation.md](navigation.md) | Navigation patterns & transitions |
| [components.md](components.md) | Mobile-native UI components |

---

## Quick Reference

### The Thumb Zone

Design for one-handed use. Primary actions in easy-reach zones.

```
┌─────────────────────┐
│     Hard to reach   │  ← Secondary actions
├─────────────────────┤
│                     │
│    Natural reach    │  ← Content, scrolling
│                     │
├─────────────────────┤
│    Easy to reach    │  ← Primary navigation
└─────────────────────┘
        👍
```

### Touch Target Sizes

| Element | Minimum | Recommended |
|---------|---------|-------------|
| Buttons | 44×44px | 48×48px |
| Icons | 24×24px | 32×32px (with 48px tap area) |
| List items | 44px height | 56-72px height |
| Spacing | 8px | 12-16px |

### Safe Areas

```css
/* Handle notches and home indicators */
padding-top: env(safe-area-inset-top);
padding-bottom: env(safe-area-inset-bottom);
padding-left: env(safe-area-inset-left);
padding-right: env(safe-area-inset-right);
```

### Typography Scale

```
Page Title:      24-28px  (bold)
Section Header:  18-20px  (semibold)
Body Text:       16-17px  (regular) ← minimum readable
Secondary:       14-15px  (regular)
Caption:         12-13px  (regular)
```

---

## Platform Conventions

### iOS vs Android Patterns

| Element | iOS | Android |
|---------|-----|---------|
| **Navigation** | Bottom tab bar | Bottom nav or drawer |
| **Back** | Left edge swipe | System back button |
| **Actions** | Top-right bar | FAB or top-right |
| **Lists** | Swipe for actions | Long-press context menu |
| **Modals** | Sheet from bottom | Full-screen or dialog |
| **Switches** | iOS toggle style | Material switch |

### When to Use Which

- **Bottom tabs**: 3-5 top-level destinations
- **Drawer**: 6+ destinations or secondary nav
- **Stack**: Linear flows (checkout, onboarding)
- **Modal sheet**: Quick actions, selections

---

## Mobile Archetypes

### List-Detail App
```
┌─────────────────────┐    ┌─────────────────────┐
│ ☰ Items         🔍  │    │ ← Item Detail       │
├─────────────────────┤    ├─────────────────────┤
│ ┌─────────────────┐ │    │                     │
│ │ Item 1       → │ │──▶│    [Image/Hero]     │
│ └─────────────────┘ │    │                     │
│ ┌─────────────────┐ │    │    Title            │
│ │ Item 2       → │ │    │    Description...   │
│ └─────────────────┘ │    │                     │
│ ┌─────────────────┐ │    │                     │
│ │ Item 3       → │ │    ├─────────────────────┤
│ └─────────────────┘ │    │    [Action Button]  │
├─────────────────────┤    └─────────────────────┘
│ 🏠  📋  👤         │
└─────────────────────┘
```

### Dashboard App
```
┌─────────────────────┐
│ Dashboard       ⚙️  │
├─────────────────────┤
│ ┌────┐ ┌────┐      │
│ │ 42 │ │ $1K│      │  ← KPIs
│ └────┘ └────┘      │
├─────────────────────┤
│ ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁   │  ← Chart
├─────────────────────┤
│ • Recent item 1    │
│ • Recent item 2    │  ← Quick list
│ • Recent item 3    │
├─────────────────────┤
│ 📊  📈  ⚙️         │
└─────────────────────┘
```

### Form/Wizard App
```
┌─────────────────────┐
│ ← Step 2 of 4       │
├─────────────────────┤
│ ●───●───○───○       │  ← Progress
├─────────────────────┤
│                     │
│ Your Details        │
│                     │
│ ┌─────────────────┐ │
│ │ Name            │ │
│ └─────────────────┘ │
│ ┌─────────────────┐ │
│ │ Email           │ │
│ └─────────────────┘ │
│                     │
├─────────────────────┤
│    [ Continue ]     │
└─────────────────────┘
```

---

## Accessibility

1. **Touch targets**: 48×48px minimum for accessibility
2. **Color contrast**: 4.5:1 for text, 3:1 for UI
3. **Font sizes**: 16px minimum, support Dynamic Type
4. **Screen readers**: Proper labels, focus order
5. **Reduced motion**: Respect `prefers-reduced-motion`

---

## Performance

1. **60fps scrolling**: Use `transform` and `opacity` only
2. **Touch responsiveness**: < 100ms visual feedback
3. **Passive listeners**: `{ passive: true }` for scroll/touch
4. **Image optimization**: WebP, lazy loading, srcset
5. **Font loading**: System fonts or `font-display: swap`

---

## CSS Requirements

```css
/* Essential mobile meta */
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">

/* Prevent text size adjustment */
html {
  -webkit-text-size-adjust: 100%;
}

/* Smooth scrolling with momentum */
.scrollable {
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

/* Disable tap highlight */
* {
  -webkit-tap-highlight-color: transparent;
}

/* Safe areas */
body {
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
}
```
