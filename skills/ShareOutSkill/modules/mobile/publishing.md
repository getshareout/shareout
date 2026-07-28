# Publishing Mobile Artifacts

How to publish ShareOut artifacts with mobile support and PWA features.

---

## Basic Publishing

### Web Only (Current)

```javascript
const sdk = new ShareOut();

await sdk.publish({
  slug: 'my-artifact',
  title: 'My Artifact',
  html: htmlContent
});
```

### With Mobile Version

```javascript
await sdk.publish({
  slug: 'my-app',
  title: 'My App',

  // Desktop/tablet version
  html: webHtml,

  // Mobile-specific version
  mobile_html: mobileHtml
});
```

### With PWA

```javascript
await sdk.publish({
  slug: 'my-app',
  title: 'My App',
  html: webHtml,
  mobile_html: mobileHtml,

  // PWA configuration
  pwa: {
    enabled: true,
    name: 'My App',
    short_name: 'MyApp',
    icon: iconBase64,
    theme_color: '#3b82f6',
    background_color: '#ffffff'
  }
});
```

---

## Publish API

### Request

```http
POST /v1/publish
Authorization: Bearer so_xxx
Content-Type: application/json

{
  "slug": "my-app",
  "title": "My App",
  "html": "<html>...</html>",
  "mobile_html": "<html>...</html>",
  "pwa": {
    "enabled": true,
    "name": "My App",
    "short_name": "MyApp",
    "icon": "data:image/png;base64,...",
    "theme_color": "#3b82f6",
    "background_color": "#ffffff",
    "display": "standalone",
    "orientation": "any"
  },
  "visibility": "public"
}
```

### Response

```json
{
  "id": "art_abc123",
  "slug": "my-app",
  "url": "$ORIGIN/a/my-app/",
  "mobile_url": "$ORIGIN/a/my-app/?v=mobile",
  "pwa": {
    "manifest_url": "$ORIGIN/a/my-app/manifest.json",
    "service_worker_url": "$ORIGIN/a/my-app/sw.js",
    "installable": true
  },
  "created_at": "2024-01-15T10:00:00Z"
}
```

---

## URL Behavior

### Automatic Device Detection

| Device | URL Served |
|--------|------------|
| Desktop browser | `html` (web version) |
| Tablet | `html` by default |
| Mobile browser | `mobile_html` if provided |
| PWA (installed) | `mobile_html` |

### Manual Override

```
$ORIGIN/a/my-app/?v=web     → Force web version
$ORIGIN/a/my-app/?v=mobile  → Force mobile version
```

### Detection Logic

```javascript
// Server-side logic (pseudo-code)
function detectVersion(request) {
  // 1. Check query param override
  if (request.query.v === 'web') return 'web';
  if (request.query.v === 'mobile') return 'mobile';

  // 2. Check if mobile_html exists
  if (!artifact.mobile_html) return 'web';

  // 3. Detect device from User-Agent
  const ua = request.headers['user-agent'];
  const isMobile = /iPhone|iPad|Android|Mobile/i.test(ua);

  return isMobile ? 'mobile' : 'web';
}
```

---

## Mobile HTML Requirements

### Essential Meta Tags

```html
<!DOCTYPE html>
<html>
<head>
  <!-- Viewport for mobile -->
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">

  <!-- Prevent text size adjustment -->
  <meta name="format-detection" content="telephone=no">

  <!-- Theme color for browser chrome -->
  <meta name="theme-color" content="#3b82f6">

  <!-- PWA meta (auto-added by ShareOut if pwa.enabled) -->
  <link rel="manifest" href="/manifest.json">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
</head>
<body>
  ...
</body>
</html>
```

### Mobile SDK Script

```html
<!-- Include mobile SDK for features -->
<script src="$ORIGIN/sdk/shareout-mobile.js"></script>

<script>
  ShareOut.mobile.init({
    navigation: { type: 'bottom-tabs', tabs: [...] },
    haptics: true
  });
</script>
```

---

## PWA Assets

### Icon Generation

When you provide a 512×512 icon, ShareOut generates:

```json
{
  "icons": [
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-384.png", "sizes": "384x384", "type": "image/png" },
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-152.png", "sizes": "152x152", "type": "image/png" },
    { "src": "/icons/icon-144.png", "sizes": "144x144", "type": "image/png" },
    { "src": "/icons/icon-128.png", "sizes": "128x128", "type": "image/png" },
    { "src": "/icons/icon-96.png", "sizes": "96x96", "type": "image/png" },
    { "src": "/icons/icon-72.png", "sizes": "72x72", "type": "image/png" }
  ]
}
```

### Generated Manifest

```json
{
  "name": "My App",
  "short_name": "MyApp",
  "start_url": "/a/my-app/",
  "scope": "/a/my-app/",
  "display": "standalone",
  "orientation": "any",
  "theme_color": "#3b82f6",
  "background_color": "#ffffff",
  "icons": [...]
}
```

### Generated Service Worker

```javascript
// /a/my-app/sw.js (simplified)
const CACHE_NAME = 'my-app-v1';
const CACHED_URLS = [
  '/a/my-app/',
  '/a/my-app/manifest.json',
  // ... inline assets
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHED_URLS))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
```

---

## Updating Published Artifacts

### Update Web Only

```javascript
await sdk.publish({
  slug: 'my-app',  // Existing slug
  html: newWebHtml
  // mobile_html unchanged
});
```

### Update Mobile Only

```javascript
await sdk.publish({
  slug: 'my-app',
  mobile_html: newMobileHtml
  // html unchanged
});
```

### Update Both

```javascript
await sdk.publish({
  slug: 'my-app',
  html: newWebHtml,
  mobile_html: newMobileHtml
});
```

### PWA Cache Invalidation

When updating, increment the cache version:

```javascript
await sdk.publish({
  slug: 'my-app',
  html: newHtml,
  mobile_html: newMobileHtml,
  pwa: {
    ...existingConfig,
    offline: {
      cacheName: 'my-app-v2'  // Increment version
    }
  }
});
```

---

## Version Management

### Create Named Version

```javascript
await sdk.artifacts.createVersion('my-app', {
  name: 'v1.0.0',
  description: 'Initial release'
});
```

### Rollback

```javascript
// Get versions
const versions = await sdk.artifacts.getVersions('my-app');

// Rollback to previous
await sdk.artifacts.rollback('my-app', versions[1].id);
```

---

## Visibility Options

```javascript
await sdk.publish({
  slug: 'my-app',
  html: htmlContent,

  visibility: 'private'  // or 'workspace', 'public'
});
```

| Visibility | Behavior |
|------------|----------|
| `private` *(default)* | Owner + people explicitly shared with |
| `workspace` | Owner + collaborators + all workspace members (artifact must belong to a workspace) |
| `public` | Anyone on the internet with the link; listed, searchable |

---

## Analytics

### Track Mobile vs Web

ShareOut automatically tracks:

```javascript
// Available in analytics
{
  views: {
    total: 1000,
    web: 400,
    mobile: 600
  },
  pwa: {
    installs: 150,
    activeUsers: 89
  }
}
```

### Access Analytics

```javascript
const stats = await sdk.artifacts.getAnalytics('my-app');

console.log(stats.views.mobile);      // Mobile web views
console.log(stats.pwa.installs);      // PWA installations
```

---

## Best Practices

### 1. Test Both Versions

```javascript
// Development: test mobile locally
// Use Chrome DevTools device simulation

// Production URLs:
// Web:    $ORIGIN_HOST/a/my-app/?v=web
// Mobile: $ORIGIN_HOST/a/my-app/?v=mobile
```

### 2. Keep Mobile HTML Lightweight

```javascript
// Don't include desktop-only features
const mobileHtml = minify(mobileHtmlSource);

// Target < 500KB for fast mobile load
```

### 3. Progressive Enhancement

```html
<!-- Mobile HTML should work without JS -->
<noscript>
  <style>
    .js-only { display: none; }
  </style>
</noscript>
```

### 4. Handle Offline Gracefully

```javascript
ShareOut.mobile.on('offline', () => {
  showOfflineBanner();
});

ShareOut.mobile.on('online', () => {
  hideOfflineBanner();
  syncPendingActions();
});
```

### 5. Test PWA Installation

```bash
# Use Lighthouse for PWA audit
npx lighthouse $ORIGIN/a/my-app --only-categories=pwa
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Mobile version not showing | Check User-Agent detection, try `?v=mobile` |
| PWA not installable | Verify HTTPS, manifest, service worker |
| Old content showing | Clear service worker cache, increment version |
| Icons wrong size | Provide 512×512 source icon |
| Offline not working | Check service worker registration in DevTools |

### Debug Mode

```javascript
await sdk.publish({
  slug: 'my-app',
  html: htmlContent,

  // Enable debug headers
  debug: true
});

// Response headers include:
// X-ShareOut-Version: mobile
// X-ShareOut-Cache: miss
// X-ShareOut-PWA: enabled
```
