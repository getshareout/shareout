# Publishing

Dual-artifact system: Editor mode for creating, Published mode for sharing.

## Architecture

Every dashboard has two URLs:

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   EDITOR                              PUBLISHED                │
│   $ORIGIN_HOST/a/{slug}             $ORIGIN_HOST/p/{slug}   │
│                                                                │
│   ┌──────────────────┐               ┌──────────────────┐     │
│   │                  │   real-time   │                  │     │
│   │   Full editing   │ ───────────►  │   View only      │     │
│   │   Collaboration  │     sync      │   Interactive    │     │
│   │   Versions       │               │   Filters work   │     │
│   │   Auth required  │               │   Shareable      │     │
│   │                  │               │                  │     │
│   └──────────────────┘               └──────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Creating a Dashboard

Both artifacts created automatically:

```javascript
const result = await sdk.dashboards.create({
  title: 'Sales Dashboard',
  visibility: 'public'
});

console.log(result.editorUrl);      // $ORIGIN_HOST/a/sales-dashboard
console.log(result.publishedUrl);   // $ORIGIN_HOST/p/sales-dashboard
```

### Response

```typescript
interface CreateResult {
  id: string;                    // Dashboard ID
  editorUrl: string;             // $ORIGIN_HOST/a/{slug}
  publishedUrl: string;          // $ORIGIN_HOST/p/{slug}
  editorArtifactId: string;      // Editor artifact ID
  publishedArtifactId: string;   // Published artifact ID
}
```

---

## Editor Mode (`/a/{slug}`)

Full editing capabilities.

### Authentication

Requires logged-in user with appropriate role:

```javascript
// Opens editor - requires auth
const dashboard = await sdk.dashboards.open('sales-dashboard');

// If not authenticated → redirect to login
// If no permission → 403 error
```

### Features

- Real-time collaborative editing
- Widget management (add, delete, move, resize)
- Data source configuration
- Filter definitions
- Version history
- Collaborator management
- All SDK features

---

## Published Mode (`/p/{slug}`)

View-only, interactive, shareable link.

### Opening

```javascript
// Opens for viewing - no auth required (based on visibility)
const dashboard = await sdk.dashboards.view('sales-dashboard');
```

### Features

- View all widgets
- Interactive filters (use existing filters)
- Real-time data updates
- Follow presenter (if active)
- See pointer position
- Real-time updates from editor

### Not Available

- Edit widgets or layout
- Change data sources
- Modify filter definitions
- Manage versions
- Change collaborators
- Access editor UI

### Filter Interaction

Published viewers CAN interact with filters:

```javascript
// Published mode - filters work
dashboard.filters.setValue('region', 'na');  // ✓ Works
dashboard.presets.apply('preset-q4');        // ✓ Works

// But cannot modify definitions
dashboard.filters.addDefinition({...});      // ✗ Error
```

---

## Real-Time Sync

Published mirrors editor in real-time:

```
Editor User                          Published Viewer
     │                                     │
     │  Updates widget                     │
     │         │                           │
     ▼         │                           │
  Y.js Doc ────┼──────────────────────────►│
               │         WebSocket          │
               │          sync             ▼
               │                      Sees update
               │                      immediately
```

### How It Works

1. Both artifacts share same Y.js document
2. Editor has write access
3. Published has read-only access
4. Changes propagate via WebSocket

### Latency

- Typical: 50-200ms
- Users see changes almost instantly

---

## Visibility Settings

Control who can access published version:

### Options

| Visibility | Access | Discoverable |
|------------|--------|--------------|
| `public` | Anyone on the internet with the link | Yes |
| `private` | Collaborators only | No |

### Setting Visibility

```javascript
// Set visibility
dashboard.publish.setVisibility('public');
dashboard.publish.setVisibility('private');

// Get current
const meta = dashboard.meta.get();
console.log(meta.visibility);  // 'public'
```

### Visibility Behavior

**Public:**
- Appears in workspace homepage (Teams)
- Indexed by search engines
- Anyone on the internet with the link can view

**Private:**
- Only collaborators (owner, editors, viewers) can access
- Requires authentication
- Good for: internal dashboards

---

## Unpublish / Republish

Temporarily hide published version:

```javascript
// Hide published version
dashboard.publish.unpublish();
// Published URL returns 404

// Restore published version
dashboard.publish.republish();
// Published URL works again
```

### Use Cases

- Work in progress - hide until ready
- Corrections needed - hide temporarily
- Time-limited sharing - unpublish after event

---

## URL Patterns

### Standard URLs

```
$ORIGIN_HOST/a/{slug}     → Editor
$ORIGIN_HOST/p/{slug}     → Published
```

### Teams Subdomains

```
{workspace}.example.com/a/{slug}   → Editor
{workspace}.example.com/p/{slug}   → Published
```

### Embed URLs

Embed artifacts in external websites via iframe:

```
$ORIGIN_HOST/embed/{slug}   → Embeddable iframe
```

**Usage:**
```html
<iframe
  src="$ORIGIN/embed/my-dashboard/"
  width="100%"
  height="600"
  frameborder="0"
></iframe>
```

**Visibility rules:**
- `public`: Embeddable by default
- `private`: Cannot be embedded (returns 403)

**Configure embedding via API:**
```javascript
// Disable embedding
await fetch('/v1/artifacts/{id}', {
  method: 'PATCH',
  body: JSON.stringify({ embed_allowed: false })
});

// Restrict to specific origins
await fetch('/v1/artifacts/{id}', {
  method: 'PATCH',
  body: JSON.stringify({
    embed_origins: ['https://example.com', 'https://docs.mysite.com']
  })
});
```

---

## Sharing

### Get Shareable URL

```javascript
const url = dashboard.publish.getUrl();
// '$ORIGIN/p/sales-dashboard'

// Copy to clipboard
await navigator.clipboard.writeText(url);
```

### Share Dialog (UI)

```javascript
function showShareDialog() {
  const url = dashboard.publish.getUrl();
  const visibility = dashboard.meta.get().visibility;

  return {
    url,
    visibility,
    setVisibility: (v) => dashboard.publish.setVisibility(v),
    copyUrl: () => navigator.clipboard.writeText(url)
  };
}
```

---

## Presenter Mode from Published

Viewers can follow presenter:

```javascript
// From published view
dashboard.presenter.subscribe(state => {
  if (state.isPresenting) {
    // Someone is presenting
    // Follow their focus
    enterFollowMode(state);
  }
});
```

### Standalone Interaction

If no one is presenting, viewer can interact normally:

```javascript
// Viewer can use filters
dashboard.filters.setValue('region', 'na');

// Viewer can apply presets
dashboard.presets.apply('preset-this-week');
```

---

## SEO & Link Previews

Add Open Graph tags to the dashboard HTML `<head>`. ShareOut extracts them on publish for Slack/WhatsApp/iMessage link previews. See [shared publishing guide](../_shared/publishing.md#link-previews-slack-whatsapp-imessage).

```html
<head>
  <title>Sales Dashboard</title>
  <meta name="description" content="Real-time sales metrics and analytics...">
  <meta property="og:title" content="Sales Dashboard">
  <meta property="og:description" content="Real-time sales metrics and analytics...">
  <meta property="og:image" content="$ORIGIN/t/art_abc123.webp">
  <meta name="twitter:card" content="summary_large_image">
</head>
```

If `og:image` is omitted, ShareOut uses an auto-generated screenshot (`POST /v1/artifacts/{id}/screenshot` to regenerate).

---

## Analytics (Teams)

Track published dashboard views:

```javascript
// Owner can see analytics
const stats = await dashboard.analytics.get();
// {
//   views: 1234,
//   uniqueViewers: 456,
//   avgViewDuration: 180,
//   filterUsage: { region: 234, dateRange: 567 },
//   widgetClicks: { 'chart-revenue': 89, 'table-pipeline': 45 }
// }
```

---

## Best Practices

1. **Use private for controlled sharing:** Only people you invite can view — no random discovery
2. **Set public only when needed:** Anyone on the internet can find it; index-worthy content
3. **Unpublish drafts:** Hide work in progress
4. **Share published URL, not editor:** Keep editing private
5. **Check visibility before sharing:** Avoid access issues
