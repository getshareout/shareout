# PWA (Progressive Web App) Setup

Configure ShareOut artifacts as installable apps with offline support and homescreen icons.

---

## What is PWA?

Progressive Web Apps make web content feel like native apps:

| Feature | Web | PWA |
|---------|-----|-----|
| Install to homescreen | ❌ | ✓ |
| App icon | ❌ | ✓ |
| Splash screen | ❌ | ✓ |
| Full-screen mode | ❌ | ✓ |
| Offline support | ❌ | ✓ |
| Push notifications | ❌ | ✓ (coming) |

---

## Quick Start

### Enable PWA on Publish

PWA is a field on the normal publish call — there is no `sdk.publish()`; publish over REST
([api/artifacts.md](../../api/artifacts.md#post-v1publish)):

```http
POST /v1/publish
Authorization: Bearer so_xxx
Content-Type: application/json

{
  "name": "My App",
  "slug": "my-app",
  "entrypoint": "index.html",
  "files": [{ "path": "index.html", "content": "<!DOCTYPE html>...", "mime": "text/html", "encoding": "utf8" }],
  "pwa": {
    "enabled": true,
    "name": "My App",
    "short_name": "MyApp",
    "icon": "data:image/png;base64,...",
    "theme_color": "#3b82f6",
    "background_color": "#ffffff"
  }
}
```

### What ShareOut Generates

When `pwa.enabled: true`, ShareOut:

1. **Serves manifest.json** at `/a/{slug}/manifest.json` (`start_url` defaults to and `scope` is `$ORIGIN/a/{slug}/`, the canonical routing URL — not the workspace subdomain URL)
2. **Serves your icon** at `/a/{slug}/_pwa/icon-{size}.png` (see [Icon Requirements](#icon-requirements))
3. **Serves a service worker** at `/a/{slug}/sw.js` for offline caching
4. **Adds meta tags** to the HTML for iOS/Android

---

## Configuration Options

### Full PWA Options

These are all the fields the server reads; anything else is ignored.

```javascript
pwa: {
  // Required
  enabled: true,
  name: 'My Application',      // Full app name
  short_name: 'MyApp',         // Homescreen name (keep ≤ 12 chars)
  icon: iconBase64,            // 512x512 PNG, base64 (data: URL prefix optional)

  // Optional
  description: 'What the app does',
  theme_color: '#3b82f6',      // Browser chrome color
  background_color: '#ffffff', // Splash screen background
  display: 'standalone',       // standalone | fullscreen | minimal-ui | browser
  orientation: 'any',          // any | portrait | landscape
  start_url: '/a/my-app/',     // Where the app opens (default: the artifact URL)

  // Optional - Offline
  offline: {
    enabled: true,
    strategy: 'cache-first',   // cache-first | network-first
    cacheName: 'my-app-v1',
    assets: ['styles.css', 'assets/logo.png']  // Additional assets to cache
  }
}
```

### Display Modes

| Mode | Browser UI | Use Case |
|------|------------|----------|
| `standalone` | No URL bar | Most apps (recommended) |
| `fullscreen` | No status bar | Games, immersive |
| `minimal-ui` | Back/reload only | Apps needing nav |
| `browser` | Full browser | Standard web |

---

## Icon Requirements

Provide **one** square 512×512 PNG as `pwa.icon`. ShareOut does **not** resize it: the manifest
lists sizes 512, 384, 192, 152, 144, 128, 96 and 72 (plus 512/192 as `maskable`), and every
`/a/{slug}/_pwa/icon-{size}.png` path returns that same 512×512 file — browsers and launchers
scale it down. Design the icon so it still reads at small sizes, and keep important content in
the maskable safe zone below. There is no per-size override.

### Maskable Icons

Android adaptive icons need a "safe zone":

```
┌─────────────────────────┐
│  ┌─────────────────┐    │
│  │                 │    │
│  │  Safe Zone 80%  │    │  ← Content here only
│  │                 │    │
│  └─────────────────┘    │
│                         │  ← May be cropped
└─────────────────────────┘
```

---

## Offline Support

### Caching Strategies

```javascript
pwa: {
  offline: {
    strategy: 'cache-first'  // or 'network-first'
  }
}
```

| Strategy | Behavior | Best For |
|----------|----------|----------|
| `cache-first` | Serve from cache, update in background | Static content |
| `network-first` | Try network, fall back to cache | Dynamic content |

### What Gets Cached

By default, ShareOut caches:
- The HTML document
- Inline CSS and JS
- Referenced images (same origin)
- Custom fonts

### Custom Asset Caching

```javascript
pwa: {
  offline: {
    assets: [
      '/api/data.json',        // API response
      '/fonts/custom.woff2',   // External font
      '/images/hero.jpg'       // Large image
    ]
  }
}
```

### Offline Fallback Page

```javascript
pwa: {
  offline: {
    fallbackPage: `
      <html>
        <body>
          <h1>You're offline</h1>
          <p>Please reconnect to continue.</p>
        </body>
      </html>
    `
  }
}
```

---

## Install Prompt

### Automatic Prompt

There is no `installPrompt` config: the browser decides when to offer installation once the
manifest and service worker are valid. To control the timing, use a custom button (below).

### Custom Install Button

```javascript
// In your mobile_html
<button id="install-btn" style="display: none;">
  Install App
</button>

<script>
  // Check if installable
  if (ShareOut.mobile.pwa.canInstall()) {
    document.getElementById('install-btn').style.display = 'block';
  }

  // Handle install
  document.getElementById('install-btn').onclick = async () => {
    const installed = await ShareOut.mobile.pwa.promptInstall();
    if (installed) {
      console.log('App installed!');
    }
  };

  // Listen for install
  ShareOut.mobile.pwa.onInstalled(() => {
    document.getElementById('install-btn').style.display = 'none';
    showToast('App installed to home screen!');
  });
</script>
```

### Install Eligibility

PWA install prompt requires:
1. HTTPS (ShareOut provides this)
2. Valid manifest
3. Service worker registered
4. User engagement (varies by browser)

---

## Splash Screen

### Auto-Generated Splash

ShareOut creates splash screens from your config:

```
┌─────────────────────────┐
│                         │
│                         │
│         [Icon]          │
│                         │
│        App Name         │
│                         │
│                         │
└─────────────────────────┘
Background: background_color
```

### Custom Splash (iOS)

iOS requires specific splash images:

```javascript
pwa: {
  splash: {
    // iOS requires specific sizes
    ios: [
      { width: 1170, height: 2532, image: splash1170x2532 },
      { width: 1125, height: 2436, image: splash1125x2436 },
      // ... other sizes
    ]
  }
}
```

---

## Service Worker

### Generated Service Worker

ShareOut generates a service worker that:

```javascript
// Pseudo-code of generated SW

// Install: Cache core assets
self.addEventListener('install', (event) => {
  caches.open('my-app-v1').then((cache) => {
    cache.addAll([
      '/',
      '/manifest.json',
      // ... your assets
    ]);
  });
});

// Fetch: Serve from cache or network
self.addEventListener('fetch', (event) => {
  // cache-first or network-first based on config
});

// Activate: Clean old caches
self.addEventListener('activate', (event) => {
  // Remove outdated cache versions
});
```

### Custom Service Worker Logic

```javascript
pwa: {
  serviceWorker: {
    // Add custom handlers
    customFetch: `
      // This code runs inside the service worker
      if (event.request.url.includes('/api/')) {
        // Custom API caching logic
        event.respondWith(
          fetch(event.request).catch(() => {
            return caches.match('/offline-api-response.json');
          })
        );
        return;
      }
    `
  }
}
```

---

## Testing PWA

### Chrome DevTools

1. Open DevTools → Application tab
2. Check "Manifest" for configuration
3. Check "Service Workers" for SW status
4. Check "Cache Storage" for cached assets

### Lighthouse Audit

```bash
# Run PWA audit
npx lighthouse $ORIGIN/a/my-app --only-categories=pwa
```

### Testing Offline

1. DevTools → Network → Offline checkbox
2. Or: DevTools → Application → Service Workers → Offline

### Simulate Install

Chrome: DevTools → Application → Manifest → "Add to homescreen" link

---

## Platform-Specific Notes

### iOS Safari

```javascript
// iOS requires additional meta tags (auto-added by ShareOut)
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="My App">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
```

**iOS Limitations:**
- No install prompt (users must use Share → Add to Home Screen)
- Service worker limited to 50MB cache
- Background sync not supported
- Push notifications require specific setup

### Android Chrome

- Shows install prompt automatically
- Supports all PWA features
- Can be published to Play Store via TWA

### Samsung Internet

- Full PWA support
- Can be added via browser menu

---

## Updating PWA

### Version Updates

```javascript
pwa: {
  offline: {
    cacheName: 'my-app-v2',  // Increment version
    skipWaiting: true        // Activate new SW immediately
  }
}
```

### Update Notification

```javascript
// Detect when new version is available
ShareOut.mobile.pwa.onUpdateAvailable(() => {
  showToast('New version available! Refresh to update.', {
    action: {
      text: 'Refresh',
      onPress: () => location.reload()
    }
  });
});
```

---

## Best Practices

### Do

- Use 512×512 PNG icon with transparent background
- Test on real devices, not just emulator
- Keep cached assets minimal for fast install
- Handle offline state gracefully in UI
- Update cache version when content changes

### Don't

- Cache large files (videos, huge images)
- Assume push notifications work everywhere
- Forget to test update flow
- Use display: fullscreen unless needed
- Ignore iOS-specific requirements

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Install prompt not showing | Check HTTPS, manifest, SW registration |
| Splash screen wrong size | Provide multiple iOS splash sizes |
| Old content after update | Increment cache version |
| Offline not working | Check service worker in DevTools |
| Icon looks wrong on Android | Provide maskable icon |
