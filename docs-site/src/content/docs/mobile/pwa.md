---
title: PWA setup
description: Make a ShareOut artifact installable — manifest, icons, offline caching, and the install prompt.
---

When you set `pwa.enabled: true` in `sdk.publish()`, ShareOut generates a Web App Manifest, registers a service worker, auto-sizes your icon, and shows an install prompt to eligible visitors. HTTPS is provided automatically.

## Quick start

```javascript
const sdk = new ShareOut();

await sdk.publish({
  slug: 'my-app',
  title: 'My App',
  html: appHtml,
  pwa: {
    enabled: true,
    name: 'My App',
    short_name: 'MyApp',
    icon: iconBase64,         // 512×512 PNG, base64-encoded
    theme_color: '#3b82f6',
    background_color: '#ffffff'
  }
});
```

ShareOut then automatically:

1. Creates `manifest.json` at `/a/{slug}/manifest.json`
2. Generates icons at every required size (192, 512, and more)
3. Registers a service worker for offline caching
4. Injects iOS/Android meta tags into the HTML
5. Shows an install prompt to eligible visitors

## All PWA options

```javascript
pwa: {
  // Required
  enabled: true,
  name: 'My Application',       // Full app name (max 45 chars)
  short_name: 'MyApp',          // Homescreen label (max 12 chars)
  icon: iconBase64,             // 512×512 PNG

  // Appearance
  theme_color: '#3b82f6',       // Browser chrome tint
  background_color: '#ffffff',  // Splash screen background
  display: 'standalone',        // standalone | fullscreen | minimal-ui | browser

  // Behavior
  start_url: '/',
  scope: '/',
  orientation: 'any',           // any | portrait | landscape

  // Extra icons
  icons: {
    favicon: favicon16Base64,   // 16×16 for the browser tab
    apple_touch: icon180Base64, // 180×180 for iOS
    maskable: maskableIcon512   // Android adaptive icon (80 % safe zone)
  },

  // Offline
  offline: {
    enabled: true,
    strategy: 'cache-first',    // cache-first | network-first
    cacheName: 'my-app-v1',
    assets: ['/fonts/inter.woff2', '/images/logo.png']
  },

  // Install prompt
  installPrompt: {
    enabled: true,
    delay: 5000,                // ms before showing (0 = immediate)
    text: 'Install for quick access and offline use',
    buttonText: 'Install'
  }
}
```

## Display modes

| Mode | Browser UI | Best for |
|---|---|---|
| `standalone` | No URL bar | Most apps (recommended) |
| `fullscreen` | No status bar | Games, immersive experiences |
| `minimal-ui` | Back/reload only | Apps that need navigation |
| `browser` | Full browser | Standard web content |

## Icons

Provide one 512 × 512 PNG. ShareOut generates every size automatically:

| Size | Purpose |
|---|---|
| 512 × 512 | Splash screen, high-res |
| 192 × 192 | Android homescreen |
| 180 × 180 | iOS homescreen |
| 152 × 152 | iPad |
| 32 × 32 | Favicon |
| 16 × 16 | Favicon |

For Android adaptive icons, keep your artwork inside the **central 80 %** of the canvas — the outer ring may be cropped by the launcher.

## Offline caching

| Strategy | Behavior | Best for |
|---|---|---|
| `cache-first` | Serve from cache; update in background | Static content |
| `network-first` | Try network; fall back to cache | Dynamic content |

By default, ShareOut caches the HTML document, inline CSS/JS, same-origin images, and custom fonts. Add extra assets:

```javascript
offline: {
  assets: ['/api/data.json', '/fonts/custom.woff2']
}
```

Custom offline fallback:

```javascript
offline: {
  fallbackPage: '<html><body><h1>You\'re offline</h1></body></html>'
}
```

## Install prompt

### Automatic prompt

```javascript
installPrompt: { enabled: true, delay: 5000 }
```

ShareOut shows a bottom banner after the delay if the browser considers the app installable (HTTPS + valid manifest + service worker + user engagement).

### Custom install button

```javascript
// Inside mobile_html
if (ShareOut.mobile.pwa.canInstall()) {
  document.getElementById('install-btn').style.display = 'block';
}

document.getElementById('install-btn').onclick = async () => {
  const result = await ShareOut.mobile.pwa.promptInstall();
  if (result.outcome === 'accepted') ShareOutUI.toast('App installed!');
};

ShareOut.mobile.pwa.onInstalled(() => {
  document.getElementById('install-btn').style.display = 'none';
});
```

### React to install state changes

```javascript
ShareOut.mobile.pwa.onInstallStateChange(state => {
  // state = { canInstall: boolean, installed: boolean }
  installBtn.style.display = state.canInstall ? 'block' : 'none';
});
```

## Updating a PWA

Increment `cacheName` whenever you ship new content, then set `skipWaiting` so the new service worker activates immediately:

```javascript
offline: {
  cacheName: 'my-app-v2',
  skipWaiting: true
}
```

Notify users when an update is ready:

```javascript
ShareOut.mobile.pwa.onUpdateAvailable(() => {
  ShareOutUI.toast('Update available — refresh to apply.', {
    type: 'warning', duration: 8000
  });
});
```

## Platform notes

**iOS Safari** — install requires Share → "Add to Home Screen" (no automatic prompt). ShareOut injects the required `apple-mobile-web-app-*` meta tags automatically. Service worker cache is limited to 50 MB; background sync is not supported.

**Chrome on Android** — full PWA support; install prompt fires automatically. Can be published to the Play Store via Trusted Web Activity (TWA).

**Samsung Internet** — full PWA support via browser menu.

## SDK API summary

| Method | Description |
|---|---|
| `ShareOut.mobile.pwa.canInstall()` | `boolean` — prompt is available |
| `ShareOut.mobile.pwa.promptInstall()` | `Promise<{ outcome }>` — trigger prompt |
| `ShareOut.mobile.pwa.isInstalled()` | `boolean` — running as installed PWA |
| `ShareOut.mobile.pwa.onInstallStateChange(fn)` | Subscribe to install state |
| `ShareOut.mobile.pwa.registerServiceWorker(path?)` | `Promise<Registration>` |
| `ShareOut.mobile.pwa.updateServiceWorker()` | Force update check |
| `ShareOut.mobile.pwa.onUpdateAvailable(fn)` | Called when new SW is waiting |

## Testing

**Chrome DevTools** → Application tab → Manifest / Service Workers / Cache Storage.

**Lighthouse:**

```bash
npx lighthouse https://shareout.site/a/my-app --only-categories=pwa
```

**Offline simulation:** DevTools → Network → check "Offline", or Application → Service Workers → check "Offline".

**Install simulation:** DevTools → Application → Manifest → "Add to homescreen".

## Troubleshooting

| Symptom | Fix |
|---|---|
| Install prompt not showing | Confirm HTTPS, valid manifest, SW registered, prior engagement |
| Splash screen wrong size | Provide multiple iOS splash images via `pwa.splash.ios` |
| Old content after update | Increment `cacheName` |
| Offline not working | Check service worker status in DevTools |
| Icon looks wrong on Android | Provide a maskable icon with 80 % safe zone |
