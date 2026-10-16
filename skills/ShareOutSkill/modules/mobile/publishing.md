# Publishing Mobile Artifacts

How to publish ShareOut artifacts with a mobile-specific version and PWA features.

There is **no** `sdk.publish()` in the browser SDK — publishing is the REST call
`POST /v1/publish` (full reference: [api/artifacts.md](../../api/artifacts.md#post-v1publish)).
Mobile and PWA are two optional fields on that same call.

---

## Publish API

### Request

```http
POST /v1/publish
Authorization: Bearer so_xxx
Content-Type: application/json

{
  "name": "My App",
  "slug": "my-app",
  "entrypoint": "index.html",
  "files": [
    { "path": "index.html", "content": "<!DOCTYPE html>...", "mime": "text/html", "encoding": "utf8" }
  ],
  "mobile_html": "<!DOCTYPE html>...",
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

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Display name (`title` is not accepted) |
| `files` | Yes | `[{ path, content, mime?, encoding? }]` — the desktop/web version; `html` is not accepted |
| `entrypoint` | No | Defaults to `index.html` |
| `slug` | No | Re-publishing with the same slug updates the artifact |
| `mobile_html` | No | Mobile version, stored as `mobile.html` next to the entrypoint |
| `pwa` | No | See [pwa.md](pwa.md#full-pwa-options) for every field |

### Response

```json
{
  "artifact": { "id": "art_abc123" },
  "version": { "id": "ver_xyz789", "version_no": 1 },
  "deployment": {
    "slug": "my-app",
    "url": "$ORIGIN/a/my-app/",
    "mobile_url": "$ORIGIN/a/my-app/?v=mobile"
  },
  "pwa": {
    "manifest_url": "$ORIGIN/a/my-app/manifest.json",
    "service_worker_url": "$ORIGIN/a/my-app/sw.js",
    "installable": true
  }
}
```

`deployment.mobile_url` is present only when `mobile_html` was sent; `pwa` only when PWA is enabled.

---

## URL Behavior

| Device | Served |
|--------|--------|
| Desktop / tablet browser | entrypoint (web version) |
| Mobile browser | `mobile_html` if provided, else the web version |

Override with `?v=web` or `?v=mobile`:

```
$ORIGIN/a/my-app/?v=web     → Force web version
$ORIGIN/a/my-app/?v=mobile  → Force mobile version
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
  <link rel="manifest" href="manifest.json">
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
<script src="/sdk/shareout-mobile.js"></script>

<script>
  ShareOut.mobile.init({
    navigation: { type: 'bottom-tabs', tabs: [...] },
    haptics: true
  });
</script>
```

---

## PWA Assets

With `pwa.enabled`, ShareOut serves `manifest.json`, `sw.js` and `_pwa/icon-{size}.png` under
`/a/{slug}/`. Icons are **not** resized — every size path returns your single 512×512 `pwa.icon`
(see [pwa.md](pwa.md#icon-requirements)).

---

## Updating Published Artifacts

Re-publish with the same `slug`. Each publish is a complete new version: send the full `files`
array again, plus `mobile_html` / `pwa` if the new version should keep them.

To force installed PWAs to drop old cached assets, change `pwa.offline.cacheName`
(e.g. `my-app-v1` → `my-app-v2`) in the new publish.

Versions and restore: [api/artifacts.md](../../api/artifacts.md#versions--restore).

---

## Visibility

`visibility` works exactly as on any publish — see [api/artifacts.md](../../api/artifacts.md#post-v1publish).

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `400 VALIDATION_ERROR` on publish | Send `name` + `files[]` (not `title` / `html`) |
| Mobile version not showing | Check User-Agent detection, try `?v=mobile` |
| PWA not installable | Verify HTTPS, manifest, service worker in DevTools |
| Old content showing | Change `pwa.offline.cacheName` and re-publish |
| Icon blurry or cropped | Provide a crisp 512×512 PNG; keep content in the maskable safe zone |

```bash
# Lighthouse PWA audit
npx lighthouse $ORIGIN/a/my-app --only-categories=pwa
```
