# Mobile Navigation Patterns

Navigation patterns and transitions for native-feeling mobile experiences.

---

## Navigation Types

### Bottom Tab Bar

**Best for: 3-5 top-level destinations**

```
┌─────────────────────────────────┐
│ Home                        ⚙️  │
├─────────────────────────────────┤
│                                 │
│         Page Content            │
│                                 │
│                                 │
├─────────────────────────────────┤
│  🏠      📋      🔍      👤    │
│ Home   Items  Search  Profile   │
└─────────────────────────────────┘
```

```javascript
ShareOut.mobile.navigation({
  type: 'bottom-tabs',
  container: '#tab-bar',

  tabs: [
    { id: 'home', icon: 'home', label: 'Home', badge: null },
    { id: 'items', icon: 'list', label: 'Items', badge: 3 },
    { id: 'search', icon: 'search', label: 'Search' },
    { id: 'profile', icon: 'user', label: 'Profile' }
  ],

  activeTab: 'home',

  onChange: (tabId, prevTabId) => {
    showView(tabId);
    ShareOut.mobile.haptic('light');
  },

  // Style options
  style: {
    background: '#ffffff',
    activeColor: '#3b82f6',
    inactiveColor: '#9ca3af',
    height: 56,
    safeArea: true  // Respect home indicator
  }
});
```

### Tab Bar Guidelines

| Guideline | Recommendation |
|-----------|----------------|
| **Tab count** | 3-5 tabs (5 max) |
| **Labels** | Always show, max 10 chars |
| **Icons** | 24-28px, outlined (filled when active) |
| **Badge** | Numbers or dot, max 99+ |
| **Height** | 49-56px + safe area |

---

### Stack Navigation

**Best for: Linear flows, drill-down content**

```
Screen A         Screen B         Screen C
┌────────┐       ┌────────┐       ┌────────┐
│   A    │  ──▶  │ ← B    │  ──▶  │ ← C    │
│        │       │        │       │        │
│ [Next] │       │ [Next] │       │ [Done] │
└────────┘       └────────┘       └────────┘
                      │
                 ◀────┘ (back)
```

```javascript
ShareOut.mobile.navigation({
  type: 'stack',
  container: '#app',
  initialView: 'home'
});

// Push new screen (slide in from right)
ShareOut.mobile.push('detail', {
  id: 123,
  title: 'Item Detail'
});

// Pop back (slide out to right)
ShareOut.mobile.pop();

// Replace current (no animation)
ShareOut.mobile.replace('login');

// Pop to root
ShareOut.mobile.popToRoot();

// Pop multiple
ShareOut.mobile.pop(2);  // Go back 2 screens
```

### Stack Transitions

```javascript
// Custom transition options
ShareOut.mobile.push('screen', data, {
  transition: 'slide',      // slide, fade, none
  direction: 'left',        // left, right, up, down
  duration: 300,            // ms
  easing: 'ease-out'
});

// Modal presentation (slides up)
ShareOut.mobile.present('modal', data, {
  presentation: 'modal',
  transition: 'slide-up'
});

// Dismiss modal
ShareOut.mobile.dismiss();
```

---

### Drawer Navigation

**Best for: 6+ destinations, settings, secondary nav**

```
┌─────────────────────────────────┐
│ ☰ App Name              🔔  👤 │
├─────────────────────────────────┤
│                                 │
│         Main Content            │
│                                 │
└─────────────────────────────────┘

        ▼ swipe from left or tap ☰

┌─────────┬───────────────────────┐
│ ┌─────┐ │                       │
│ │ 👤  │ │                       │
│ │ John│ │    (dimmed content)  │
│ └─────┘ │                       │
├─────────┤                       │
│ 🏠 Home │                       │
│ 📊 Dash │                       │
│ ⚙️ Set  │                       │
│ ❓ Help │                       │
├─────────┤                       │
│ 🚪 Out  │                       │
└─────────┴───────────────────────┘
```

```javascript
ShareOut.mobile.navigation({
  type: 'drawer',
  position: 'left',  // or 'right'

  header: {
    avatar: userAvatarUrl,
    name: 'John Doe',
    subtitle: 'john@example.com'
  },

  items: [
    { type: 'item', id: 'home', icon: 'home', label: 'Home' },
    { type: 'item', id: 'dashboard', icon: 'grid', label: 'Dashboard' },
    { type: 'divider' },
    { type: 'item', id: 'settings', icon: 'cog', label: 'Settings' },
    { type: 'item', id: 'help', icon: 'help', label: 'Help' },
    { type: 'divider' },
    { type: 'item', id: 'logout', icon: 'logout', label: 'Sign Out', danger: true }
  ],

  onChange: (itemId) => navigateTo(itemId),

  // Open with swipe from edge
  edgeSwipe: true,
  edgeWidth: 20,  // px from edge

  // Styling
  style: {
    width: 280,
    background: '#ffffff',
    overlay: 'rgba(0,0,0,0.5)'
  }
});

// Programmatic control
ShareOut.mobile.drawer.open();
ShareOut.mobile.drawer.close();
ShareOut.mobile.drawer.toggle();
```

---

## Back Navigation

### Handling Back

```javascript
// Listen for back navigation
ShareOut.mobile.onBack((event) => {
  // Return true to handle, false to use default
  if (hasUnsavedChanges) {
    showConfirmDialog();
    return true;  // Prevent back
  }
  return false;  // Allow default back
});

// iOS: Edge swipe back
ShareOut.mobile.edgeSwipeBack({
  enabled: true,
  threshold: 50,  // px
  onStart: () => {},
  onProgress: (percent) => {},
  onComplete: () => ShareOut.mobile.pop(),
  onCancel: () => {}
});
```

### Back Button States

| State | Behavior |
|-------|----------|
| **Stack depth > 1** | Pop to previous screen |
| **Stack depth = 1** | Close app (or do nothing) |
| **Modal open** | Dismiss modal |
| **Drawer open** | Close drawer |
| **Has changes** | Show confirmation |

---

## Header/App Bar

### Standard Header

```
┌──────────────────────────────────────────┐
│ ← Title                        🔍  ⋮    │
└──────────────────────────────────────────┘
  │   │                          │   │
  │   │                          │   └─ More menu
  │   │                          └─ Search
  │   └─ Page title (centered or left)
  └─ Back/menu button
```

```javascript
ShareOut.mobile.header({
  container: '#header',

  left: {
    type: 'back',       // 'back', 'menu', 'close', 'custom'
    onPress: () => ShareOut.mobile.pop()
  },

  title: 'Page Title',
  subtitle: 'Optional subtitle',

  right: [
    { icon: 'search', onPress: openSearch },
    { icon: 'more', onPress: openMenu }
  ],

  // Large title (iOS-style, collapses on scroll)
  largeTitle: {
    enabled: true,
    collapseOnScroll: '#content'
  },

  style: {
    background: '#ffffff',
    textColor: '#1f2937',
    height: 56,
    safeArea: true
  }
});
```

### Collapsing Header

```
Before scroll:                  After scroll:
┌─────────────────────┐        ┌─────────────────────┐
│ ←               ⋮   │        │ ← Page Title    ⋮   │
├─────────────────────┤        ├─────────────────────┤
│                     │        │ Content scrolled    │
│    Page Title       │   ──▶  │ up with header      │
│    (large)          │        │ collapsed           │
├─────────────────────┤        │                     │
│ Content             │        │                     │
└─────────────────────┘        └─────────────────────┘
```

---

## Transitions

### Transition Types

| Transition | Direction | Use Case |
|------------|-----------|----------|
| `slide` | left/right | Stack navigation |
| `slide-up` | up | Modal presentation |
| `slide-down` | down | Dismiss, refresh result |
| `fade` | - | Replace, crossfade |
| `none` | - | Instant switch |

### CSS Transitions

```css
/* Slide from right (push) */
.screen-enter {
  transform: translateX(100%);
}
.screen-enter-active {
  transform: translateX(0);
  transition: transform 300ms ease-out;
}

/* Slide to right (pop) */
.screen-exit {
  transform: translateX(0);
}
.screen-exit-active {
  transform: translateX(100%);
  transition: transform 300ms ease-in;
}

/* Parallax effect on underlying screen */
.screen-behind {
  transform: translateX(-30%);
  transition: transform 300ms ease-out;
}

/* Modal slide up */
.modal-enter {
  transform: translateY(100%);
}
.modal-enter-active {
  transform: translateY(0);
  transition: transform 300ms ease-out;
}
```

### Shared Element Transitions

```javascript
// Animate element between screens
ShareOut.mobile.push('detail', { id: item.id }, {
  sharedElements: [
    {
      id: `item-${item.id}-image`,
      fromElement: '.list-item-image',
      toElement: '.detail-hero-image'
    }
  ]
});
```

---

## Bottom Sheets

**Half-screen modals that slide up from bottom.**

```
┌─────────────────────────────────┐
│                                 │
│         Main Content            │
│         (dimmed)                │
│                                 │
├─────────────────────────────────┤
│ ═══════════ (drag handle)      │
│                                 │
│    Sheet Content                │
│    • Option 1                   │
│    • Option 2                   │
│    • Option 3                   │
│                                 │
│    [Primary Action]             │
│                                 │
└─────────────────────────────────┘
```

```javascript
ShareOut.mobile.sheet({
  content: '#sheet-content',

  // Height options
  snapPoints: ['25%', '50%', '90%'],  // Snap positions
  initialSnap: '50%',

  // Behavior
  dismissible: true,         // Can swipe down to close
  closeOnOverlay: true,      // Tap overlay to close
  dragHandle: true,          // Show drag indicator

  // Callbacks
  onOpen: () => {},
  onClose: () => {},
  onSnap: (point) => {},

  // Styling
  style: {
    background: '#ffffff',
    borderRadius: 16,
    overlay: 'rgba(0,0,0,0.4)'
  }
});

// Programmatic control
ShareOut.mobile.sheet.open();
ShareOut.mobile.sheet.close();
ShareOut.mobile.sheet.snapTo('90%');
```

### Sheet Use Cases

| Use Case | Snap Points |
|----------|-------------|
| **Action menu** | `['auto']` - fit content |
| **Filter panel** | `['50%', '90%']` |
| **Details preview** | `['30%', '70%']` |
| **Full editor** | `['90%']` |

---

## Safe Areas

### Handling Device Cutouts

```css
/* Full safe area handling */
.screen {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}

/* Only bottom (for tab bar) */
.tab-bar {
  padding-bottom: env(safe-area-inset-bottom);
}

/* Viewport fit for edge-to-edge */
<meta name="viewport" content="viewport-fit=cover">
```

### Safe Area Diagram

```
┌─────────────────────────────────┐
│░░░░░░░░░ status bar ░░░░░░░░░░░│ ← safe-area-inset-top
├─────────────────────────────────┤
│         ┌───────┐               │
│         │ notch │               │ ← Dynamic Island/Notch
│         └───────┘               │
│                                 │
│      Safe content area          │
│                                 │
│                                 │
├─────────────────────────────────┤
│░░░░░░ home indicator ░░░░░░░░░░│ ← safe-area-inset-bottom
└─────────────────────────────────┘
```

---

## Navigation State Persistence

### Save/Restore State

```javascript
// Save navigation state
const state = ShareOut.mobile.navigation.getState();
localStorage.setItem('navState', JSON.stringify(state));

// Restore on app launch
const savedState = localStorage.getItem('navState');
if (savedState) {
  ShareOut.mobile.navigation.restoreState(JSON.parse(savedState));
}
```

### Deep Linking

```javascript
ShareOut.mobile.deepLink({
  routes: {
    '/': 'home',
    '/items/:id': 'item-detail',
    '/profile': 'profile',
    '/settings': 'settings'
  },

  onRoute: (route, params) => {
    // Handle deep link
    if (route === 'item-detail') {
      ShareOut.mobile.push('detail', { id: params.id });
    }
  }
});

// Generate shareable link
const link = ShareOut.mobile.createLink('item-detail', { id: 123 });
// → $ORIGIN/a/my-app/items/123
```
