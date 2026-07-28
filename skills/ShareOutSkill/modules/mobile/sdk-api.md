# Mobile SDK API Reference

Complete API reference for ShareOut mobile features.

---

## Installation

```html
<!-- Auto-loaded when PWA enabled, or manually include -->
<script src="$ORIGIN/sdk/shareout-mobile.js"></script>
```

---

## Initialization

### ShareOut.mobile.init()

Initialize mobile optimizations.

```javascript
ShareOut.mobile.init({
  viewport: true,              // Set mobile-optimized viewport
  safeArea: true,              // Apply safe area CSS variables
  preventOverscroll: false,    // Disable iOS bounce
  themeColor: '#3b82f6',       // Browser UI color
  registerServiceWorker: true  // Auto-register sw.js
});
```

**Parameters:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `viewport` | boolean | true | Set mobile viewport meta tag |
| `safeArea` | boolean | true | Apply safe area CSS variables |
| `preventOverscroll` | boolean | false | Disable overscroll/bounce |
| `themeColor` | string | — | Set theme-color meta tag |
| `registerServiceWorker` | boolean | false | Auto-register service worker |

---

## Device Detection

### ShareOut.mobile.isMobile()

Check if running on a mobile device.

```javascript
if (ShareOut.mobile.isMobile()) {
  // Mobile-specific logic
}
```

### ShareOut.mobile.isIOS()

```javascript
if (ShareOut.mobile.isIOS()) {
  // iOS-specific logic (iPhone, iPad, iPod)
}
```

### ShareOut.mobile.isAndroid()

```javascript
if (ShareOut.mobile.isAndroid()) {
  // Android-specific logic
}
```

### ShareOut.mobile.isStandalone()

Check if running as installed PWA.

```javascript
if (ShareOut.mobile.isStandalone()) {
  // Running as installed app
  hideInstallButton();
}
```

---

## PWA

### ShareOut.mobile.pwa.canInstall()

Check if the app can be installed.

```javascript
if (ShareOut.mobile.pwa.canInstall()) {
  showInstallButton();
}
```

### ShareOut.mobile.pwa.promptInstall()

Trigger the install prompt.

```javascript
const result = await ShareOut.mobile.pwa.promptInstall();

if (result.outcome === 'accepted') {
  console.log('User installed the app');
} else {
  console.log('User dismissed the prompt');
}
```

**Returns:** `Promise<{ outcome: 'accepted' | 'dismissed', error?: string }>`

### ShareOut.mobile.pwa.isInstalled()

Check if running as installed PWA (alias for `isStandalone()`).

```javascript
if (ShareOut.mobile.pwa.isInstalled()) {
  hideInstallPrompt();
}
```

### ShareOut.mobile.pwa.onInstallStateChange()

Listen for install state changes.

```javascript
const unsubscribe = ShareOut.mobile.pwa.onInstallStateChange((state) => {
  // state = { canInstall: boolean, installed: boolean }
  if (state.canInstall) showInstallButton();
  if (state.installed) hideInstallButton();
});

// Later: unsubscribe();
```

### ShareOut.mobile.pwa.registerServiceWorker()

Register the service worker.

```javascript
try {
  const registration = await ShareOut.mobile.pwa.registerServiceWorker('sw.js');
  console.log('SW registered:', registration.scope);
} catch (error) {
  console.error('SW registration failed:', error);
}
```

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `swPath` | string | `'sw.js'` | Path to service worker file |

**Returns:** `Promise<ServiceWorkerRegistration>`

### ShareOut.mobile.pwa.updateServiceWorker()

Force update check for service worker.

```javascript
await ShareOut.mobile.pwa.updateServiceWorker();
```

---

## Navigation

Stack-based navigation with browser history integration.

### ShareOut.mobile.navigation.push()

Push a new route onto the navigation stack.

```javascript
ShareOut.mobile.navigation.push('detail', {
  data: { id: 123, name: 'Item' },
  url: '/detail/123'  // Optional custom URL
});
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `route` | string | Route identifier |
| `options.data` | object | Data to pass to route |
| `options.url` | string | Custom URL (default: `#route`) |
| `options.replaceUrl` | boolean | Whether to update URL (default: true) |

### ShareOut.mobile.navigation.pop()

Go back to previous route.

```javascript
const popped = ShareOut.mobile.navigation.pop();
// Returns the popped state object, or null if at root
```

### ShareOut.mobile.navigation.replace()

Replace current route without adding to history.

```javascript
ShareOut.mobile.navigation.replace('home', {
  data: { fresh: true }
});
```

### ShareOut.mobile.navigation.currentRoute()

Get the current route.

```javascript
const route = ShareOut.mobile.navigation.currentRoute();
// e.g., 'detail'
```

### ShareOut.mobile.navigation.stackDepth()

Get navigation stack depth.

```javascript
const depth = ShareOut.mobile.navigation.stackDepth();
// e.g., 3
```

### ShareOut.mobile.navigation.canGoBack()

Check if can navigate back.

```javascript
if (ShareOut.mobile.navigation.canGoBack()) {
  showBackButton();
}
```

### ShareOut.mobile.navigation.reset()

Reset navigation stack to initial route.

```javascript
ShareOut.mobile.navigation.reset('home');
```

### ShareOut.mobile.navigation.onNavigate()

Listen for navigation events.

```javascript
const unsubscribe = ShareOut.mobile.navigation.onNavigate((event) => {
  // event = { type: 'push'|'pop'|'replace', route: string, state: object }
  console.log(`Navigated ${event.type} to ${event.route}`);
});

// Later: unsubscribe();
```

---

## Haptics

Haptic feedback using the Vibration API.

### ShareOut.mobile.haptics.light()

Light tap feedback.

```javascript
ShareOut.mobile.haptics.light();
```

### ShareOut.mobile.haptics.medium()

Medium tap feedback.

```javascript
ShareOut.mobile.haptics.medium();
```

### ShareOut.mobile.haptics.heavy()

Heavy impact feedback.

```javascript
ShareOut.mobile.haptics.heavy();
```

### ShareOut.mobile.haptics.success()

Success pattern feedback.

```javascript
ShareOut.mobile.haptics.success();
```

### ShareOut.mobile.haptics.warning()

Warning pattern feedback.

```javascript
ShareOut.mobile.haptics.warning();
```

### ShareOut.mobile.haptics.error()

Error pattern feedback.

```javascript
ShareOut.mobile.haptics.error();
```

### ShareOut.mobile.haptics.selection()

Selection change feedback (lightest).

```javascript
ShareOut.mobile.haptics.selection();
```

### ShareOut.mobile.haptics.custom()

Custom vibration pattern.

```javascript
// Single duration (ms)
ShareOut.mobile.haptics.custom(50);

// Pattern: [vibrate, pause, vibrate, pause, ...]
ShareOut.mobile.haptics.custom([20, 100, 40, 100, 20]);
```

### ShareOut.mobile.haptics.isSupported()

Check if haptics are supported.

```javascript
if (ShareOut.mobile.haptics.isSupported()) {
  ShareOut.mobile.haptics.medium();
} else {
  // Visual feedback fallback
}
```

---

## Gestures

### ShareOut.mobile.gestures.create()

Create a gesture handler for an element.

```javascript
const handler = ShareOut.mobile.gestures.create('#container', {
  swipeThreshold: 50,     // Min distance for swipe (px)
  swipeVelocity: 0.3,     // Min velocity for swipe
  longPressDelay: 500,    // Long press duration (ms)
  doubleTapDelay: 300     // Double tap window (ms)
});
```

**Parameters:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `swipeThreshold` | number | 50 | Minimum swipe distance in pixels |
| `swipeVelocity` | number | 0.3 | Minimum swipe velocity |
| `longPressDelay` | number | 500 | Long press duration in ms |
| `doubleTapDelay` | number | 300 | Double tap detection window in ms |

**Returns:** Gesture handler object

### Gesture Handler Methods

```javascript
const handler = ShareOut.mobile.gestures.create(element);

// Subscribe to events
handler
  .on('swipeLeft', (event) => {
    // event = { velocity, deltaX }
  })
  .on('swipeRight', (event) => {
    // event = { velocity, deltaX }
  })
  .on('swipeUp', (event) => {
    // event = { velocity, deltaY }
  })
  .on('swipeDown', (event) => {
    // event = { velocity, deltaY }
  })
  .on('longPress', (event) => {
    // event = { x, y }
  })
  .on('doubleTap', (event) => {
    // event = { x, y }
  })
  .on('pan', (event) => {
    // event = { deltaX, deltaY, x, y }
  });

// Unsubscribe
handler.off('swipeLeft', callback);

// Cleanup
handler.destroy();
```

**Events:**

| Event | Callback Data | Description |
|-------|---------------|-------------|
| `swipeLeft` | `{ velocity, deltaX }` | Swipe left detected |
| `swipeRight` | `{ velocity, deltaX }` | Swipe right detected |
| `swipeUp` | `{ velocity, deltaY }` | Swipe up detected |
| `swipeDown` | `{ velocity, deltaY }` | Swipe down detected |
| `longPress` | `{ x, y }` | Long press detected |
| `doubleTap` | `{ x, y }` | Double tap detected |
| `pan` | `{ deltaX, deltaY, x, y }` | Pan/drag movement |

### ShareOut.mobile.gestures.enableSwipeBack()

Enable swipe-to-go-back gesture.

```javascript
const handler = ShareOut.mobile.gestures.enableSwipeBack(document.body, {
  swipeThreshold: 50
});

// Auto-triggers navigation.pop() on swipe right

// Cleanup
handler.destroy();
```

---

## Pull to Refresh

### ShareOut.mobile.createPullToRefresh()

Create a pull-to-refresh component.

```javascript
const ptr = ShareOut.mobile.createPullToRefresh(
  '#scrollable-content',
  async () => {
    // Refresh callback - called when user pulls and releases
    await fetchNewData();
    // Component auto-hides when promise resolves
  },
  {
    threshold: 80,    // Pull distance to trigger (px)
    maxPull: 120,     // Maximum pull distance (px)
    resistance: 2.5   // Pull resistance factor
  }
);
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `element` | string \| HTMLElement | Scrollable container |
| `onRefresh` | `() => Promise<void>` | Async refresh callback |
| `options.threshold` | number | Pull distance to trigger (default: 80) |
| `options.maxPull` | number | Maximum pull distance (default: 120) |
| `options.resistance` | number | Pull resistance (default: 2.5) |
| `options.indicatorHTML` | string | Custom indicator HTML |

**Returns:** Pull-to-refresh controller

```javascript
// Programmatically trigger refresh
ptr.refresh();

// Cleanup
ptr.destroy();
```

---

## Bottom Sheet

### ShareOut.mobile.createBottomSheet()

Create a draggable bottom sheet.

```javascript
const sheet = ShareOut.mobile.createBottomSheet({
  snapPoints: [0.25, 0.5, 0.9],  // Height percentages
  initialSnap: 1,                 // Start at 50%
  dismissible: true,              // Can swipe to dismiss
  backdrop: true,                 // Show backdrop overlay
  content: '<h2>Options</h2><ul>...</ul>'
});
```

**Parameters:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `snapPoints` | number[] | `[0.25, 0.5, 0.9]` | Height snap points (0-1) |
| `initialSnap` | number | 0 | Initial snap point index |
| `dismissible` | boolean | true | Allow swipe to dismiss |
| `backdrop` | boolean | true | Show backdrop overlay |
| `content` | string \| HTMLElement | `''` | Sheet content |

**Returns:** Bottom sheet controller

```javascript
// Open sheet
sheet.open();

// Snap to specific point
sheet.snapTo(2);  // Expand to 90%

// Update content
sheet.setContent('<div>New content</div>');

// Check state
if (sheet.isOpen()) {
  // Sheet is visible
}

// Close sheet
sheet.close();

// Cleanup
sheet.destroy();
```

---

## Safe Area

Handle device safe areas (notch, home indicator).

### ShareOut.mobile.safeArea.getInsets()

Get safe area insets.

```javascript
const insets = ShareOut.mobile.safeArea.getInsets();
// { top: 47, right: 0, bottom: 34, left: 0 }
```

### ShareOut.mobile.safeArea.applyCustomProperties()

Apply safe area as CSS custom properties.

```javascript
ShareOut.mobile.safeArea.applyCustomProperties();
```

This sets:
- `--sat`: Safe area top
- `--sar`: Safe area right
- `--sab`: Safe area bottom
- `--sal`: Safe area left

Use in CSS:
```css
.header {
  padding-top: calc(16px + var(--sat, 0px));
}
.footer {
  padding-bottom: calc(16px + var(--sab, 0px));
}
```

### ShareOut.mobile.safeArea.hasNotch()

Check if device has a notch.

```javascript
if (ShareOut.mobile.safeArea.hasNotch()) {
  // Adjust layout for notch
}
```

---

## Utilities

### ShareOut.mobile.utils.setMobileViewport()

Set optimized mobile viewport.

```javascript
ShareOut.mobile.utils.setMobileViewport();
// Sets: width=device-width, initial-scale=1, maximum-scale=1,
//       user-scalable=no, viewport-fit=cover
```

### ShareOut.mobile.utils.setThemeColor()

Set browser theme color.

```javascript
ShareOut.mobile.utils.setThemeColor('#3b82f6');
```

### ShareOut.mobile.utils.preventOverscroll()

Disable iOS bounce/overscroll.

```javascript
ShareOut.mobile.utils.preventOverscroll();
```

### ShareOut.mobile.utils.disableSelection()

Disable text selection on an element.

```javascript
ShareOut.mobile.utils.disableSelection(element);
```

### ShareOut.mobile.utils.enableMomentumScroll()

Enable iOS momentum scrolling.

```javascript
ShareOut.mobile.utils.enableMomentumScroll(element);
```

---

## Version

### ShareOut.mobile.version

Get SDK version.

```javascript
console.log(ShareOut.mobile.version);
// '1.0.0'
```

---

## Auto-Init

Add `data-auto-init` attribute to auto-initialize:

```html
<script src="$ORIGIN/sdk/shareout-mobile.js" data-auto-init></script>
```

Equivalent to calling:
```javascript
document.addEventListener('DOMContentLoaded', () => {
  ShareOut.mobile.init();
});
```

---

## Complete Example

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Mobile App</title>
  <style>
    :root {
      --sat: env(safe-area-inset-top);
      --sab: env(safe-area-inset-bottom);
    }
    .header {
      padding-top: calc(16px + var(--sat));
      background: #3b82f6;
      color: white;
    }
    .content {
      padding: 16px;
      padding-bottom: calc(16px + var(--sab));
    }
  </style>
</head>
<body>
  <div class="header">
    <button id="back">←</button>
    <h1>My App</h1>
  </div>
  <div id="content" class="content">
    <button id="install">Install App</button>
  </div>

  <script src="$ORIGIN/sdk/shareout-mobile.js"></script>
  <script>
    const { mobile } = ShareOut;

    // Initialize
    mobile.init({
      themeColor: '#3b82f6',
      registerServiceWorker: true
    });

    // PWA install
    const installBtn = document.getElementById('install');
    mobile.pwa.onInstallStateChange(state => {
      installBtn.style.display = state.canInstall ? 'block' : 'none';
    });
    installBtn.onclick = () => mobile.pwa.promptInstall();

    // Navigation
    const backBtn = document.getElementById('back');
    backBtn.onclick = () => {
      if (mobile.navigation.canGoBack()) {
        mobile.haptics.light();
        mobile.navigation.pop();
      }
    };

    // Gestures
    mobile.gestures.enableSwipeBack(document.body);

    // Pull to refresh
    mobile.createPullToRefresh('#content', async () => {
      await fetch('/api/refresh');
    });
  </script>
</body>
</html>
```
