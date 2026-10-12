# ShareOut Mobile Apps

Transform HTML artifacts into native-feeling mobile experiences with PWA support, app-like navigation, and add-to-homescreen capability.

## Why ShareOut Mobile?

| Feature | ShareOut Mobile | Responsive HTML |
|---------|-----------------|-----------------|
| Add to homescreen | Native app icon + splash | Browser bookmark |
| Full-screen mode | No browser chrome | Always has URL bar |
| Offline support | Service worker caching | Requires connection |
| Touch gestures | Swipe nav, pull-refresh | Basic scrolling |
| Navigation | Bottom tabs, stack, drawer | Links only |
| Transitions | Native-feel animations | Page reloads |
| Performance | 60fps touch, lazy load | Variable |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ShareOut Mobile                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐          ┌─────────────────┐          │
│  │   Web Version   │  detect  │  Mobile Version │          │
│  │ $ORIGIN_HOST/a │ ───────► │ $ORIGIN_HOST/a │          │
│  │   (desktop)     │  device  │   (mobile UA)   │          │
│  └─────────────────┘          └────────┬────────┘          │
│                                        │                    │
│                                        ▼                    │
│  ┌─────────────────────────────────────────────────┐       │
│  │              PWA Shell (Optional)                │       │
│  │  • manifest.json (icon, name, colors)            │       │
│  │  • Service worker (offline, caching)             │       │
│  │  • Add-to-homescreen prompt                      │       │
│  └─────────────────────────────────────────────────┘       │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Gestures │ │   Nav    │ │  Touch   │ │ Offline  │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Dual-Mode Publishing

Publish both web and mobile versions in a single `POST /v1/publish` (there is no `sdk.publish()`;
full field list in [publishing.md](publishing.md#publish-api)):

```json
{
  "name": "My App",
  "slug": "my-app",
  "files": [{ "path": "index.html", "content": "<!DOCTYPE html>..." }],
  "mobile_html": "<!DOCTYPE html>...",
  "pwa": {
    "enabled": true,
    "name": "My App",
    "short_name": "MyApp",
    "icon": "data:image/png;base64,...",
    "theme_color": "#3b82f6"
  }
}
```

### Automatic Device Detection

ShareOut serves the appropriate version automatically:

| User Agent | Version Served |
|------------|----------------|
| Desktop browser | `html` (web version) |
| Mobile browser | `mobile_html` (if provided) |
| Tablet | `html` by default, configurable |

Override with query param: `?v=web` or `?v=mobile`

### PWA Features

When `pwa.enabled: true`, ShareOut generates:

1. **Web App Manifest** - App metadata for homescreen
2. **Service Worker** - Offline support and caching
3. **Install Prompt** - "Add to Home Screen" banner
4. **Splash Screen** - Loading screen from icon/colors

```
User visits $ORIGIN_HOST/a/my-app on mobile
         │
         ▼
┌─────────────────────────────┐
│  "Add My App to Home Screen"│
│  [Install]  [Not Now]       │
└─────────────────────────────┘
         │
         ▼ (user taps Install)

App icon appears on home screen
         │
         ▼ (user taps icon)

App opens fullscreen, no browser UI
```

## Navigation Patterns

### Bottom Tab Bar

```javascript
// In mobile_html, use the navigation helper
ShareOut.mobile.navigation({
  type: 'bottom-tabs',
  tabs: [
    { id: 'home', icon: 'home', label: 'Home' },
    { id: 'search', icon: 'search', label: 'Search' },
    { id: 'profile', icon: 'user', label: 'Profile' }
  ],
  onChange: (tabId) => showView(tabId)
});
```

### Stack Navigation

```javascript
// Push/pop views with transitions
ShareOut.mobile.navigation({
  type: 'stack',
  initialView: 'list'
});

// Navigate with animation
ShareOut.mobile.push('detail', { id: 123 });
ShareOut.mobile.pop();
ShareOut.mobile.replace('settings');
```

### Drawer Menu

```javascript
ShareOut.mobile.navigation({
  type: 'drawer',
  position: 'left',
  items: [
    { id: 'dashboard', icon: 'grid', label: 'Dashboard' },
    { id: 'settings', icon: 'cog', label: 'Settings' },
    { id: 'help', icon: 'help', label: 'Help' }
  ]
});

// Open/close programmatically
ShareOut.mobile.drawer.open();
ShareOut.mobile.drawer.close();
```

## Touch Interactions

### Gestures

```javascript
// Swipe between views
ShareOut.mobile.swipe({
  element: '#main',
  onSwipeLeft: () => showNextView(),
  onSwipeRight: () => showPrevView()
});

// Pull to refresh
ShareOut.mobile.pullToRefresh({
  element: '#content',
  onRefresh: async () => {
    await fetchNewData();
  }
});

// Swipe actions on list items
ShareOut.mobile.swipeActions({
  element: '.list-item',
  leftAction: { icon: 'archive', color: '#3b82f6', onTrigger: archiveItem },
  rightAction: { icon: 'trash', color: '#ef4444', onTrigger: deleteItem }
});
```

### Haptic Feedback

```javascript
// Trigger haptic feedback (on supported devices)
ShareOut.mobile.haptic('light');   // Light tap
ShareOut.mobile.haptic('medium');  // Button press
ShareOut.mobile.haptic('heavy');   // Impact
ShareOut.mobile.haptic('success'); // Success pattern
ShareOut.mobile.haptic('error');   // Error pattern
```

## Quick Start

### Create a Mobile App

Mobile-optimized HTML with bottom navigation (`mobile.html`):

```html
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <script src="/sdk/shareout-mobile.js"></script>
</head>
<body>
  <main id="content">
    <!-- Views rendered here -->
  </main>

  <nav id="tabs"></nav>

  <script>
    ShareOut.mobile.init({
      navigation: {
        type: 'bottom-tabs',
        tabs: [
          { id: 'home', icon: 'home', label: 'Home' },
          { id: 'list', icon: 'list', label: 'Items' },
          { id: 'settings', icon: 'cog', label: 'Settings' }
        ]
      },
      pullToRefresh: true,
      haptics: true
    });
  </script>
</body>
</html>
```

Publish it as `mobile_html` next to your web `files`, with `pwa.enabled: true` — see [publishing.md](publishing.md#publish-api).

### Test PWA Installation

```javascript
// Check if installable
if (ShareOut.mobile.canInstall()) {
  // Show custom install button
  document.getElementById('install-btn').style.display = 'block';
}

// Trigger install prompt
document.getElementById('install-btn').onclick = () => {
  ShareOut.mobile.promptInstall();
};

// Listen for install success
ShareOut.mobile.onInstalled(() => {
  console.log('App installed to home screen!');
});
```

## Use Cases

| Scenario | Key Features |
|----------|--------------|
| **Product catalog** | Bottom tabs, swipe gallery, search |
| **Task manager** | Stack nav, swipe actions, pull-refresh |
| **Event app** | Drawer menu, offline support, notifications |
| **Portfolio** | Swipe gallery, fullscreen mode |
| **Restaurant menu** | Categories tabs, cart sheet |
| **Survey/form** | Stack nav, progress indicator |

## Reference Docs

| Topic | File |
|-------|------|
| SDK API | [sdk-api.md](sdk-api.md) |
| PWA Setup | [pwa.md](pwa.md) |
| Publishing | [publishing.md](publishing.md) |
| Design Guidelines | [design/README.md](design/README.md) |

## Browser Support

| Feature | iOS Safari | Chrome Android | Samsung Internet |
|---------|------------|----------------|------------------|
| PWA Install | 14+ | 72+ | 12+ |
| Service Worker | 11.3+ | 45+ | 4+ |
| Web App Manifest | 11.3+ | 39+ | 4+ |
| Haptic Feedback | 13+ | 89+ | Limited |
| Fullscreen API | 12+ | 38+ | 4+ |

## Integration with ShareOut SDK

Mobile features integrate with existing SDK:

| SDK Feature | Mobile Integration |
|------------|---------------------|
| `POST /v1/publish` | `mobile_html` + `pwa` fields |
| `sdk.blobs` | Icon storage for PWA |
| `sdk.realtime()` | Works in PWA mode |
| Analytics | Tracks mobile vs web views |
