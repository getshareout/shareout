# Mobile Design Principles

Core principles for creating native-feeling mobile experiences.

---

## 1. Thumb-First Design

**Design for one-handed use.**

```
┌─────────────────────────────┐
│        HARD (15%)           │  Stretch required
│         ░░░░░░░░░           │
├─────────────────────────────┤
│                             │
│       POSSIBLE (25%)        │  Slight stretch
│         ▒▒▒▒▒▒▒▒▒           │
│                             │
├─────────────────────────────┤
│                             │
│       NATURAL (60%)         │  Easy thumb reach
│         ████████████        │
│                             │
│    [Primary Actions]        │
└─────────────────────────────┘
           👍
     Right thumb
```

### Implementation

| Zone | Use For |
|------|---------|
| **Bottom** | Primary navigation, main actions |
| **Middle** | Content, scrollable areas |
| **Top** | Title, secondary actions, status |

### Anti-patterns

```
❌ Primary action at top-right
❌ FAB in top corner
❌ Navigation at top
❌ Important buttons requiring two hands
```

---

## 2. Touch-Optimized Targets

**Everything tappable should be easy to tap.**

### Minimum Sizes

```
┌────────────────────────────────────────┐
│                                        │
│   ❌ 30×30px        ✓ 48×48px         │
│   Too small         Accessible         │
│                                        │
│   ┌──────┐          ┌──────────────┐  │
│   │      │          │              │  │
│   │ Icon │          │     Icon     │  │
│   │      │          │              │  │
│   └──────┘          └──────────────┘  │
│                                        │
└────────────────────────────────────────┘
```

### Touch Target Guidelines

| Element | Min Size | Min Spacing |
|---------|----------|-------------|
| Primary buttons | 48×48px | 8px |
| Secondary buttons | 44×44px | 8px |
| Icon buttons | 48×48px tap area | 8px |
| List items | 48px height | None |
| Text links | 48px tap area | 16px |

### Invisible Tap Expansion

```css
/* Icon is 24px, tap area is 48px */
.icon-button {
  width: 24px;
  height: 24px;
  padding: 12px;  /* Expands tap area */
  margin: -12px;  /* Maintains visual position */
}
```

---

## 3. Content-First, Chrome-Last

**Maximize content area. Minimize UI chrome.**

### Good: Content Dominates
```
┌─────────────────────┐
│ Title           ⋮   │  12% chrome
├─────────────────────┤
│                     │
│                     │
│      Content        │  76% content
│                     │
│                     │
├─────────────────────┤
│ 🏠  📋  ⚙️         │  12% chrome
└─────────────────────┘
```

### Bad: Chrome Dominates
```
┌─────────────────────┐
│ Logo  🔔 👤 ⚙️ ⋮   │  }
├─────────────────────┤  } 35% chrome
│ Tab1 Tab2 Tab3 Tab4 │  }
├─────────────────────┤
│                     │
│      Content        │  50% content
│                     │
├─────────────────────┤
│ [ Action Bar ]      │  } 15% chrome
└─────────────────────┘
```

### Techniques

1. **Hide on scroll**: Auto-hide headers when scrolling down
2. **Merge bars**: Combine navigation + actions
3. **Full-bleed content**: Edge-to-edge images
4. **Floating actions**: FAB instead of toolbar

---

## 4. Progressive Disclosure

**Show less, reveal more on demand.**

### Levels

```
Level 0: Essential only (visible)
    │
    ▼ tap to expand
Level 1: Details (on demand)
    │
    ▼ tap for more
Level 2: Full info (modal/new screen)
```

### Implementation

| Pattern | Use Case |
|---------|----------|
| **Collapsed list** | Show 3, "Show all" |
| **Expandable card** | Summary + details |
| **Bottom sheet** | Actions, filters |
| **Drill-down** | List → Detail screen |

### Example: List Item

```
┌─────────────────────────────────┐
│ ┌───┐                           │
│ │ 🖼 │  Title                   │  Level 0: Visible
│ │   │  Subtitle      [Action]  │
│ └───┘                           │
├─────────────────────────────────┤
│  Full description text that     │  Level 1: Expand
│  provides more context...       │
│  [More Details] [Share]         │
└─────────────────────────────────┘
```

---

## 5. Immediate Feedback

**Every touch should have instant visual response.**

### Feedback Timeline

| Time | User Perception | Required Feedback |
|------|-----------------|-------------------|
| 0-100ms | Instant | Touch highlight |
| 100-300ms | Quick | Animation start |
| 300-1000ms | Loading | Spinner/skeleton |
| 1000ms+ | Slow | Progress indicator |

### Touch States

```css
/* Pressed state - immediate */
.button:active {
  transform: scale(0.95);
  opacity: 0.8;
}

/* Ripple effect (Android) */
.button {
  position: relative;
  overflow: hidden;
}

/* iOS-style highlight */
.list-item:active {
  background: rgba(0, 0, 0, 0.05);
}
```

### Loading Patterns

```
Skeleton Loading (preferred):
┌─────────────────────────────────┐
│ ████████████                    │
│ ██████████████████             │
│ ████████████████               │
└─────────────────────────────────┘

Spinner (for actions):
┌─────────────────────────────────┐
│         ⟳ Loading...           │
└─────────────────────────────────┘

Progress (for known duration):
┌─────────────────────────────────┐
│ ████████████░░░░░░░  75%       │
└─────────────────────────────────┘
```

---

## 6. Platform Respect

**Follow platform conventions, users expect them.**

### iOS Conventions

- Swipe from left edge = back
- Pull down = dismiss modal
- Bottom tabs for main nav
- Top-right for primary action
- System fonts (SF Pro)
- Standard blue (#007AFF) for links

### Android Conventions

- System back button
- FAB for primary action
- Navigation drawer or bottom nav
- Material You colors
- Roboto or system font
- Extended FAB for labeled actions

### Cross-Platform Compromise

When building for both:
1. Use bottom navigation (works everywhere)
2. Support both swipe-back AND back button
3. Use system font stack
4. Avoid platform-specific controls (iOS switches on Android)

---

## 7. Offline-First Mindset

**Assume connectivity is unreliable.**

### Strategies

| State | User Experience |
|-------|-----------------|
| **Online** | Normal operation |
| **Offline** | Show cached data + indicator |
| **Syncing** | Background sync, show progress |
| **Conflict** | Resolve gracefully |

### Visual Indicators

```
┌─────────────────────────────────┐
│ ⚠️ Offline - showing cached    │
├─────────────────────────────────┤
│                                 │
│      Cached content             │
│      still viewable             │
│                                 │
└─────────────────────────────────┘
```

### Caching Strategy

1. **Cache first**: Static assets, images
2. **Network first**: API data
3. **Stale-while-revalidate**: Frequently updated content

---

## 8. Gesture Economy

**Use gestures to enhance, not replace.**

### Discoverable Gestures

| Gesture | Always Discoverable | Requires Hint |
|---------|---------------------|---------------|
| Tap | ✓ Buttons, links | |
| Scroll | ✓ Content overflow | |
| Pull-to-refresh | ✓ Top of list | |
| Swipe-back | | ✓ First time |
| Swipe actions | | ✓ Always show hint |
| Long-press | | ✓ Needs onboarding |

### Gesture Hints

```
┌─────────────────────────────────┐
│ ┌───────────────────────────┐   │
│ │ Swipe for actions      ← │   │  Slight peek
│ └───────────────────────────┘   │
│ ┌───────────────────────────┐   │
│ │ Item 2                    │   │
│ └───────────────────────────┘   │
└─────────────────────────────────┘
```

### Always Provide Alternatives

```
Gesture          + Alternative
─────────────────────────────────
Swipe to delete  + ... menu → Delete
Long-press copy  + Select → Copy button
Pinch to zoom    + Zoom buttons
```

---

## 9. Respect System Settings

**Honor user preferences.**

### Settings to Respect

| Setting | Implementation |
|---------|----------------|
| **Dark mode** | `prefers-color-scheme` |
| **Reduced motion** | `prefers-reduced-motion` |
| **Font size** | Dynamic Type / Accessibility |
| **High contrast** | `prefers-contrast` |

### CSS Implementation

```css
/* Dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1a1a1a;
    --text: #ffffff;
  }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}

/* Large text */
html {
  font-size: 100%; /* Respects browser setting */
}
```

---

## 10. Error Prevention > Error Messages

**Prevent mistakes rather than explaining them.**

### Prevention Patterns

| Instead of... | Do this... |
|---------------|------------|
| "Invalid email" error | Validate as user types |
| "Required field" error | Disable submit until valid |
| "Action failed" | Confirm destructive actions |
| "Network error" | Queue and retry automatically |

### Confirmation Patterns

```
Destructive Action:
┌─────────────────────────────────┐
│                                 │
│    Delete this item?            │
│                                 │
│    This cannot be undone.       │
│                                 │
│    [Cancel]      [Delete]       │
│                      ↑ Red      │
└─────────────────────────────────┘

Undo Pattern (preferred):
┌─────────────────────────────────┐
│ Item deleted          [Undo]    │
└─────────────────────────────────┘
```
