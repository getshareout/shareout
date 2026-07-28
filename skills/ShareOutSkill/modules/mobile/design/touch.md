# Touch Interactions

Guidelines for designing touch-friendly interfaces with gestures and haptic feedback.

---

## Touch Target Fundamentals

### Size Requirements

```
┌─────────────────────────────────────────────┐
│                                             │
│    Minimum (WCAG)        Recommended        │
│                                             │
│    ┌────────────┐        ┌──────────────┐  │
│    │   44×44    │        │    48×48     │  │
│    │    px      │        │     px       │  │
│    └────────────┘        └──────────────┘  │
│                                             │
│    Adequate for          Comfortable for   │
│    most users            all users         │
│                                             │
└─────────────────────────────────────────────┘
```

### Spacing Between Targets

```
┌────────┐     ┌────────┐
│ Button │ 8px │ Button │   ← Minimum spacing
└────────┘     └────────┘

┌────────┐       ┌────────┐
│ Button │ 16px  │ Button │ ← Comfortable spacing
└────────┘       └────────┘
```

### Hit Area Expansion

```javascript
// CSS: Expand tap area beyond visual bounds
.icon-button {
  /* Visual size */
  width: 24px;
  height: 24px;

  /* Tap area (48×48) */
  padding: 12px;
  margin: -12px;

  /* Or use pseudo-element */
  position: relative;
}

.icon-button::before {
  content: '';
  position: absolute;
  top: -12px;
  right: -12px;
  bottom: -12px;
  left: -12px;
}
```

---

## Core Gestures

### Tap

**Single touch and release. The fundamental interaction.**

| Tap Type | Duration | Use Case |
|----------|----------|----------|
| Tap | < 300ms | Buttons, links, selection |
| Double-tap | Two taps < 300ms | Zoom, like (specific apps) |
| Long-press | > 500ms | Context menu, drag mode |

```javascript
// Basic tap handling
element.addEventListener('click', handler);

// Detect tap vs scroll
let startY;
element.addEventListener('touchstart', e => {
  startY = e.touches[0].clientY;
});

element.addEventListener('touchend', e => {
  const endY = e.changedTouches[0].clientY;
  if (Math.abs(endY - startY) < 10) {
    // This was a tap, not a scroll
    handleTap();
  }
});
```

### Swipe

**Horizontal or vertical drag with momentum.**

```javascript
ShareOut.mobile.swipe({
  element: '#content',
  threshold: 50,        // Min distance (px)
  velocity: 0.3,        // Min speed (px/ms)

  onSwipeLeft: () => navigateNext(),
  onSwipeRight: () => navigatePrev(),
  onSwipeUp: () => dismissSheet(),
  onSwipeDown: () => pullRefresh()
});
```

### Swipe Direction Conventions

| Direction | Common Action |
|-----------|---------------|
| **Left** | Next item, reveal actions |
| **Right** | Previous item, back, reveal actions |
| **Down** | Dismiss, refresh |
| **Up** | Reveal more, dismiss bottom sheet |

### Swipe Actions on List Items

```
┌────────────────────────────────────────────┐
│                                            │
│    At rest:                                │
│    ┌──────────────────────────────────┐   │
│    │ List Item                     →  │   │
│    └──────────────────────────────────┘   │
│                                            │
│    Swiped left:                            │
│    ┌────────────────────────────┬─────┐   │
│    │ List Item               ← │ 🗑️  │   │
│    └────────────────────────────┴─────┘   │
│                                  Delete   │
│                                            │
│    Swiped right:                           │
│    ┌─────┬────────────────────────────┐   │
│    │ ✅  │ →                List Item │   │
│    └─────┴────────────────────────────┘   │
│    Archive                                 │
│                                            │
└────────────────────────────────────────────┘
```

```javascript
ShareOut.mobile.swipeActions({
  element: '.list-item',

  leftActions: [
    { icon: 'trash', color: '#ef4444', onTrigger: deleteItem },
    { icon: 'flag', color: '#f59e0b', onTrigger: flagItem }
  ],

  rightActions: [
    { icon: 'check', color: '#10b981', onTrigger: archiveItem }
  ],

  // Snap thresholds
  revealThreshold: 80,   // px to reveal actions
  triggerThreshold: 150  // px to trigger action
});
```

---

## Pull-to-Refresh

**Pull down from top of scrollable area to refresh.**

```
┌─────────────────────────────────┐
│         ↓ Pull to refresh       │  Stage 1: Pulling
├─────────────────────────────────┤
│ Content                         │

┌─────────────────────────────────┐
│         ↻ Release to refresh    │  Stage 2: Threshold
├─────────────────────────────────┤
│ Content                         │

┌─────────────────────────────────┐
│            ⟳ Refreshing...     │  Stage 3: Loading
├─────────────────────────────────┤
│ Content                         │
```

```javascript
ShareOut.mobile.pullToRefresh({
  element: '#scrollable',
  threshold: 80,         // px to pull before triggering
  maxPull: 120,          // Max pull distance

  onRefresh: async (done) => {
    await fetchNewData();
    updateUI();
    done();  // Hide spinner
  },

  // Customization
  spinnerColor: '#3b82f6',
  text: {
    pull: 'Pull to refresh',
    release: 'Release to refresh',
    refreshing: 'Refreshing...'
  }
});
```

---

## Long Press

**Touch and hold for 500ms+.**

```javascript
ShareOut.mobile.longPress({
  element: '.item',
  duration: 500,  // ms

  onStart: (e) => {
    // Visual feedback
    e.target.classList.add('pressing');
  },

  onLongPress: (e) => {
    // Show context menu
    showContextMenu(e.target);
    ShareOut.mobile.haptic('medium');
  },

  onCancel: (e) => {
    e.target.classList.remove('pressing');
  }
});
```

### Context Menu Pattern

```
┌─────────────────────────────────┐
│ Item (long-pressed)             │
├─────────────────────────────────┤
│                                 │
│  ┌───────────────────────────┐  │
│  │ 📋 Copy                   │  │
│  ├───────────────────────────┤  │
│  │ ✏️ Edit                   │  │
│  ├───────────────────────────┤  │
│  │ 📤 Share                  │  │
│  ├───────────────────────────┤  │
│  │ 🗑️ Delete                 │  │  ← Red
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

---

## Pinch & Zoom

**Two-finger pinch to scale content.**

```javascript
ShareOut.mobile.pinchZoom({
  element: '#image',
  minScale: 1,
  maxScale: 4,
  doubleTapZoom: 2,  // Zoom level on double-tap

  onZoomStart: (scale) => {},
  onZoom: (scale) => {},
  onZoomEnd: (scale) => {}
});
```

### Image Gallery Example

```javascript
// Full gallery with pinch zoom + swipe
ShareOut.mobile.gallery({
  container: '#gallery',
  images: imageUrls,

  features: {
    pinchZoom: true,
    doubleTapZoom: true,
    swipeNavigation: true,
    swipeToClose: true
  }
});
```

---

## Haptic Feedback

**Physical vibration feedback for touches.**

### Feedback Types

| Type | Vibration | Use Case |
|------|-----------|----------|
| `light` | Subtle tick | Selection, toggle |
| `medium` | Standard tap | Button press |
| `heavy` | Strong impact | Drag threshold, error |
| `success` | Double pulse | Task complete |
| `warning` | Short-short | Caution |
| `error` | Long buzz | Error, failure |

```javascript
// Trigger haptic feedback
ShareOut.mobile.haptic('light');   // Selection
ShareOut.mobile.haptic('medium');  // Button tap
ShareOut.mobile.haptic('heavy');   // Impact
ShareOut.mobile.haptic('success'); // ✓ Complete
ShareOut.mobile.haptic('warning'); // ⚠ Warning
ShareOut.mobile.haptic('error');   // ✗ Error

// Or use the Vibration API directly
if ('vibrate' in navigator) {
  navigator.vibrate(10);           // Light
  navigator.vibrate(25);           // Medium
  navigator.vibrate([25, 50, 25]); // Pattern
}
```

### When to Use Haptics

| Scenario | Feedback |
|----------|----------|
| Button press | `medium` |
| Toggle switch | `light` |
| Pull-to-refresh threshold | `medium` |
| Swipe action trigger | `medium` |
| Delete confirmation | `heavy` |
| Success | `success` |
| Error | `error` |
| Scroll boundary | `light` |

### Browser Support

```javascript
// Check haptic support
const supportsHaptics =
  'vibrate' in navigator ||
  'Taptic' in window ||
  'HapticFeedback' in window;

// Graceful degradation
ShareOut.mobile.haptic('medium', {
  fallback: () => {
    // Visual-only feedback if no haptics
    element.classList.add('flash');
  }
});
```

---

## Touch States

### Visual Feedback CSS

```css
/* Immediate press feedback */
.touchable:active {
  opacity: 0.7;
  transform: scale(0.98);
}

/* iOS-style list item */
.list-item:active {
  background-color: rgba(0, 0, 0, 0.05);
}

/* Ripple effect (Android/Material) */
.ripple {
  position: relative;
  overflow: hidden;
}

.ripple::after {
  content: '';
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background: radial-gradient(
    circle at var(--ripple-x, 50%) var(--ripple-y, 50%),
    rgba(0, 0, 0, 0.1) 0%,
    transparent 50%
  );
  opacity: 0;
  transform: scale(0);
  transition: transform 0.4s, opacity 0.4s;
}

.ripple:active::after {
  opacity: 1;
  transform: scale(2);
  transition: none;
}
```

### Disable Default Behaviors

```css
/* Prevent text selection on touch */
.no-select {
  -webkit-user-select: none;
  user-select: none;
}

/* Prevent tap highlight */
.no-highlight {
  -webkit-tap-highlight-color: transparent;
}

/* Prevent context menu on long-press */
.no-context {
  -webkit-touch-callout: none;
}

/* Prevent zoom on double-tap */
.no-zoom {
  touch-action: manipulation;
}

/* Allow vertical scroll only */
.scroll-y-only {
  touch-action: pan-y;
}
```

---

## Performance Optimization

### Passive Event Listeners

```javascript
// ✓ Correct: passive listener for scroll
element.addEventListener('touchmove', handler, { passive: true });

// ✓ Correct: non-passive when you need preventDefault
element.addEventListener('touchmove', (e) => {
  e.preventDefault();  // Block scroll
}, { passive: false });
```

### Debouncing vs Throttling

```javascript
// Throttle: Execute at most once per interval (smooth tracking)
let lastTime = 0;
element.addEventListener('touchmove', (e) => {
  const now = Date.now();
  if (now - lastTime > 16) {  // ~60fps
    updatePosition(e);
    lastTime = now;
  }
}, { passive: true });

// Debounce: Execute after pause (end of gesture)
let timeout;
element.addEventListener('touchend', () => {
  clearTimeout(timeout);
  timeout = setTimeout(handleGestureEnd, 100);
});
```

### Animation Performance

```css
/* Only animate transform and opacity */
.animating {
  will-change: transform;
  transform: translateX(0);
  transition: transform 0.3s ease-out;
}

/* Avoid: layout-triggering properties */
.bad-animation {
  transition: left 0.3s;  /* ❌ Triggers layout */
  transition: width 0.3s; /* ❌ Triggers layout */
}
```

---

## Accessibility

### Touch Target Accessibility

```html
<!-- Proper ARIA labels for icon buttons -->
<button class="icon-button" aria-label="Delete item">
  <svg>...</svg>
</button>

<!-- Touch-friendly link areas -->
<a href="..." class="card-link">
  <div class="card">
    <!-- Entire card is tappable -->
  </div>
</a>
```

### Focus Management

```javascript
// After modal opens, focus first interactive element
modal.addEventListener('open', () => {
  modal.querySelector('button, input').focus();
});

// Trap focus within modal
modal.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    trapFocus(e, modal);
  }
});
```

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }

  /* Replace motion with fade */
  .slide-in {
    animation: fade-in 0.01ms;
  }
}
```
