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

```javascript
const sdk = new ShareOut();

await sdk.publish({
  slug: 'my-app',
  title: 'My App',
  html: appHtml,

  // Enable PWA
  pwa: {
    enabled: true,
    name: 'My App',
    short_name: 'MyApp',
    icon: iconBase64,  // 512x512 PNG, base64 encoded
    theme_color: '#3b82f6',
    background_color: '#ffffff'
  }
});
```

### What ShareOut Generates

When `pwa.enabled: true`, ShareOut automatically:

1. **Creates manifest.json** at `/a/{slug}/manifest.json`
2. **Generates icons** at multiple sizes (192, 512)
3. **Registers service worker** for offline caching
4. **Adds meta tags** to HTML for iOS/Android
5. **Shows install prompt** to eligible users

---

## Configuration Options

### Full PWA Options

```javascript
pwa: {
  // Required
  enabled: true,
  name: 'My Application',      // Full app name (max 45 chars)
  short_name: 'MyApp',         // Homescreen name (max 12 chars)
  icon: iconBase64,            // 512x512 PNG

  // Optional - Appearance
  theme_color: '#3b82f6',      // Browser chrome color
  background_color: '#ffffff', // Splash screen background
  display: 'standalone',       // standalone, fullscreen, minimal-ui

  // Optional - Behavior
  start_url: '/',              // Where app opens (default: /)
  scope: '/',                  // Navigation scope
  orientation: 'any',          // any, portrait, landscape

  // Optional - Icons
  icons: {
    favicon: favicon16Base64,  // 16x16 for browser tab
    apple_touch: icon180Base64 // 180x180 for iOS
  },

  // Optional - Offline
  offline: {
    enabled: true,
    strategy: 'cache-first',   // cache-first, network-first
    cacheName: 'my-app-v1',
    assets: [                  // Additional assets to cache
      '/fonts/inter.woff2',
      '/images/logo.png'
    ]
  },

  // Optional - Install Prompt
  installPrompt: {
    enabled: true,
    delay: 5000,               // ms before showing (0 = immediate)
    text: 'Install this app for a better experience',
    buttonText: 'Install'
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

### Required Icon

```javascript
// Minimum: 512x512 PNG
pwa: {
  icon: await readFileAsBase64('icon-512.png')
}
```

### ShareOut Auto-Generates

From your 512x512 icon, ShareOut creates:

| Size | Purpose |
|------|---------|
| 512×512 | Splash screen, high-res |
| 384×384 | Android install |
| 192×192 | Android homescreen |
| 180×180 | iOS homescreen |
| 152×152 | iPad |
| 144×144 | Android legacy |
| 128×128 | Chrome Web Store |
| 96×96 | Windows taskbar |
| 72×72 | Android low-res |
| 48×48 | Android mini |
| 32×32 | Favicon |
| 16×16 | Favicon |

### Custom Icons

```javascript
pwa: {
  icon: mainIcon512,

  // Override specific sizes
  icons: {
    favicon: favicon32,
    apple_touch: appleIcon180,
    maskable: maskableIcon512  // Safe zone icon for Android
  }
}
```

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

```javascript
pwa: {
  installPrompt: {
    enabled: true,
    delay: 5000  // Show after 5 seconds
  }
}
```

```
┌─────────────────────────────────────────┐
│ ┌─────────────────────────────────────┐ │
│ │ 📱 Add My App to Home Screen       │ │
│ │                                     │ │
│ │ Install for quick access and       │ │
│ │ offline use.                        │ │
│ │                                     │ │
│ │ [Not Now]           [Install]       │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

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
