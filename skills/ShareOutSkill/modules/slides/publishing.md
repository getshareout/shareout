# Publishing

Dual-artifact system: Editor mode for creating, Published mode for sharing.

## Architecture

Every presentation has two URLs:

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   EDITOR                              PUBLISHED                │
│   $ORIGIN_HOST/a/{slug}             $ORIGIN_HOST/p/{slug}   │
│                                                                │
│   ┌──────────────────┐               ┌──────────────────┐     │
│   │                  │   real-time   │                  │     │
│   │   Full editing   │ ───────────►  │   View only      │     │
│   │   Collaboration  │     sync      │   Presentation   │     │
│   │   Versions       │               │   mode           │     │
│   │   Auth required  │               │   Shareable      │     │
│   │                  │               │                  │     │
│   └──────────────────┘               └──────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Creating a Presentation

Both artifacts created automatically:

```javascript
const result = await sdk.slides.create({
  title: 'Q4 Review',
  visibility: 'public'
});

console.log(result.editorUrl);      // $ORIGIN_HOST/a/q4-review
console.log(result.publishedUrl);   // $ORIGIN_HOST/p/q4-review
```

### Response

```typescript
interface CreateResult {
  id: string;                    // Presentation ID
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
const presentation = await sdk.slides.open('q4-review');

// If not authenticated → redirect to login
// If no permission → 403 error
```

### Features

- Real-time collaborative editing
- Slide management (add, delete, reorder)
- Speaker notes editing
- Version history
- Collaborator management
- All SDK features

---

## Published Mode (`/p/{slug}`)

View-only, shareable link.

### Opening

```javascript
// Opens for viewing - no auth required (based on visibility)
const presentation = await sdk.slides.view('q4-review');
```

### Features

- View slides
- Presentation mode (fullscreen)
- Follow presenter (if active)
- See laser pointer
- Real-time updates from editor

### Not Available

- Edit content
- Manage versions
- Change collaborators
- Access editor UI

---

## Real-Time Sync

Published mirrors editor in real-time:

```
Editor User                          Published Viewer
     │                                     │
     │  Edits slide 3                      │
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
presentation.publish.setVisibility('public');
presentation.publish.setVisibility('private');

// Get current
const meta = presentation.meta.get();
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
- Good for: internal drafts

---

## Unpublish / Republish

Temporarily hide published version:

```javascript
// Hide published version
presentation.publish.unpublish();
// Published URL returns 404

// Restore published version
presentation.publish.republish();
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
  src="$ORIGIN/embed/my-presentation/"
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
const url = presentation.publish.getUrl();
// '$ORIGIN/p/q4-review'

// Copy to clipboard
await navigator.clipboard.writeText(url);
```

### Share Dialog (UI)

```javascript
function showShareDialog() {
  const url = presentation.publish.getUrl();
  const visibility = presentation.meta.get().visibility;

  return {
    url,
    visibility,
    setVisibility: (v) => presentation.publish.setVisibility(v),
    copyUrl: () => navigator.clipboard.writeText(url)
  };
}
```

---

## Presentation Mode from Published

Viewers can enter presentation mode:

```javascript
// From published view
presentation.presenter.subscribe(state => {
  if (state.isPresenting) {
    // Someone is presenting
    // Follow their navigation
    enterAudienceMode(state);
  }
});
```

### Standalone Presentation

If no one is presenting, viewer can self-navigate:

```javascript
// Allow self-navigation if enabled
const meta = presentation.meta.get();
if (meta.allowAudienceNavigation || !state.isPresenting) {
  showNavigationControls();
}
```

---

## SEO & Link Previews

Add Open Graph tags to the presentation HTML `<head>`. ShareOut extracts them on publish and serves them on the outer page so Slack, WhatsApp, and iMessage show a rich preview. See [shared publishing guide](../_shared/publishing.md#link-previews-slack-whatsapp-imessage) for the full field priority and API overrides.

```html
<head>
  <title>Q4 Review</title>
  <meta name="description" content="Quarterly business review...">
  <meta property="og:title" content="Q4 Review">
  <meta property="og:description" content="Quarterly business review...">
  <meta property="og:image" content="$ORIGIN/t/art_abc123.webp">
  <meta name="twitter:card" content="summary_large_image">
</head>
```

If `og:image` is omitted, ShareOut uses an auto-generated screenshot of the first slide (or `POST /v1/artifacts/{id}/screenshot` to regenerate).

---

## Analytics (Teams)

Track published presentation views:

```javascript
// Owner can see analytics
const stats = await presentation.analytics.get();
// {
//   views: 1234,
//   uniqueViewers: 456,
//   avgViewDuration: 180,
//   slideViews: { 'slide-1': 400, 'slide-2': 380, ... }
// }
```

---

## Best Practices

1. **Use private for controlled sharing:** Only people you invite can view — no random discovery
2. **Set public only when needed:** Anyone on the internet can find it; index-worthy content
3. **Unpublish drafts:** Hide work in progress
4. **Share published URL, not editor:** Keep editing private
5. **Check visibility before sharing:** Avoid access issues
