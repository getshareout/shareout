# Shared: Publishing Model

Common publishing workflow across all ShareOut modules.

## URL Model (HTML artifacts)

Every HTML artifact on the **trusted shell** (`$ORIGIN_HOST` or workspace subdomain) uses:

| URL Pattern | Purpose | Access |
|-------------|---------|--------|
| `/a/{slug}/edit` | Visual studio (Agent / Inspect / Data rail) | Owner + **named editor** collaborators (not workspace members by default) |
| `/a/{slug}/` | Live viewer — **canonical share URL** from `POST /v1/publish` | Based on visibility |
| `/p/{slug}/` | Live viewer alias (same serve path as `/a/`) | Based on visibility |

> **Slides & dashboards modules** use a separate dual-artifact model (`/a/` editor artifact + `/p/` published artifact). See [modules/slides/publishing.md](../slides/publishing.md) or [modules/dashboards/publishing.md](../dashboards/publishing.md).

Visual studio details: [core/editor.md](../../core/editor.md).

### Content host (untrusted iframe)

HTML artifact **code** runs on a separate origin — `<hex>.shareoutcdn.site` where
`<hex>` is the artifact id suffix (`art_abc123…` → `abc123….shareoutcdn.site`). The
shell at `/a/{slug}/` (or `/p/{slug}/`) embeds that origin in a sandboxed iframe.
Visitors browse the shell URL; they do not need to know the content URL.

| Concern | Where it lives |
|---------|----------------|
| Auto TL;DR + tags | Background on every HTML publish — fills empty `description` and `artifact_tags` for search/cards |
| Link previews (OG tags) | Shell URL (`/a/` or `/p/`) — crawlers never execute iframe JS |
| Session cookies | `$ORIGIN_HOST` only — not visible to artifact JS |
| Your HTML/CSS/JS | Content host iframe |
| SDK script tags | Works via `$ORIGIN/sdk/…` or relative `/sdk/…` on content host |

See [sdk/live-data.md](../../sdk/live-data.md) for sandbox auth and data access rules.

## Visibility Settings

```javascript
// Get current visibility
const visibility = await sdk.getVisibility();
// 'private' | 'workspace' | 'public'
// (`unlisted` is a retired legacy alias, still accepted and treated as `public`)

// Set visibility
await sdk.setVisibility('workspace');
```

| Visibility | Studio (`/a/{slug}/edit`) | Viewer (`/a/{slug}/`) |
|------------|---------------------------|------------------------|
| **private** *(default)* | Owner + editor collaborators | Owner + people explicitly shared with (collaborators / `share_with` / password / credentials) |
| **workspace** | Owner + editor collaborators | Owner + collaborators + **every member of the artifact's workspace** |
| **public** | Owner + editor collaborators | Anyone on the internet with the link; discoverable/indexed |

**`workspace` requires the artifact to belong to a workspace** (`workspace_id` set). A personal artifact has no workspace to share with, so it only offers `private` (plus `public` when open visibility is enabled).

**Private ≠ workspace-visible.** A `private` artifact stays owner-only even when it lives in a workspace — workspace members do **not** get access until visibility is explicitly set to `workspace`.

> **Launch note:** where open visibility is disabled (`OPEN_VISIBILITY_DISABLED`), `public` is coerced to `private`; only the "closed" states `private` and `workspace` are selectable.

**Paid visibility gate.** Public visibility requires a **paid plan** or a **paid Teams workspace** — free personal accounts are limited to `private` and `workspace`. Without entitlement, `POST /v1/publish` returns a `notice` and `PATCH /v1/artifacts/{id}` returns `VISIBILITY_HELD` instead of silently downgrading.

Transitioning **into** `public` also runs an automated content-safety check. If it isn't cleared instantly, the artifact stays `private` and the response carries a `moderation` object (publish) or `code: "MODERATION_HELD"` + `reason` (PATCH 202) — but it is re-checked automatically within the hour and auto-restored to public once it clears, so tell the user it's "under review, publishing shortly" rather than announcing a live link.

**Teams workspaces** may additionally gate member open publishes with a per-workspace policy (`allow` / `prohibit` / `require_approval`). When active, members may see `notice` and `approval_required` in publish responses while visibility stays `workspace`. See [team/publish-governance.md](../../team/publish-governance.md).

## Public artifacts: read-only by default

When visibility is `public`, anonymous visitors can **view** the artifact but **cannot** mutate private data stores, send outbound email, use the in-artifact AI chat, or join realtime collaboration — unless the owner opts in per artifact.

| Flag (`PATCH /v1/artifacts/{id}`) | Default | When `true` |
| --- | --- | --- |
| `allow_anon_write` | `false` | Anonymous visitors can mutate `sdk.json`, `sdk.table`, `sdk.blobs`, and `sdk.dataset` |
| `allow_anon_email` | `false` | Anonymous visitors can send outbound email via `sdk.email` |
| `allow_anon_agent` | `false` | Anonymous visitors can use in-artifact AI chat (`sdk.agent`) |
| `allow_anon_collab` | `false` | Anonymous visitors can join realtime collaboration (`sdk.realtime`) |

The artifact **owner** always has write access. Signed-in collaborators follow normal collaborator permissions. Anonymous mutations to gated tiers return `403` with a hint to enable the flag or sign in.

See [api/artifacts.md](../../api/artifacts.md#patch-v1artifactsid) for the full PATCH body.

## Publishing Workflow

```javascript
// Publish via REST (agents) or POST /v1/artifacts/{id}/editor/publish (studio)
// Share URL from the publish response:
//   workspace artifacts -> deployment.subdomain_url  (https://{workspace}.example.com/{slug}/)
//   personal artifacts  -> deployment.url            ($ORIGIN/a/{slug}/)
// Don't surface the apex /a/ URL for workspace artifacts — it's an internal routing key.
const publishedUrl = deployment.subdomain_url || deployment.url;

// Open the visual studio (human collaborators):
const studioUrl = `$ORIGIN/a/${slug}/edit`;
```

## Studio vs Viewer

| Aspect | Visual studio (`/a/{slug}/edit`) | Live viewer (`/a/{slug}/`) |
|--------|----------------------------------|----------------------------|
| Purpose | Edit HTML, manifest bindings, data | Share and view the artifact |
| Collaboration | Yjs + draft autosave | View-only (data still live) |
| Agent chat | ✓ | ✗ |
| Requires editor role | ✓ | Based on visibility |

## Auto-Publish Options

```javascript
// Auto-publish on save (optional)
await module.setAutoPublish(true);

// Publish delay (debounce)
await module.setAutoPublish(true, { delay: 30000 }); // 30 sec
```

## Module-Specific Notes

### Slides
- Dual-artifact model: `/a/{slug}` editor artifact, `/p/{slug}` published artifact
- Presenter mode uses the editor artifact URL

### Dashboards
- Published dashboards are read-only
- Data still updates in real-time

### Mobile
- PWA installs from published URL
- Offline cache from published snapshot

## Auto TL;DR and tags (search index)

On every **HTML publish**, ShareOut runs a background job (best-effort — never blocks publish) that reads the production entrypoint HTML and asks the model for:

```json
{ "summary": "…", "tags": ["…", "…"] }
```

| Field | Where it lands |
|-------|----------------|
| `summary` | Artifact `description` — **only if the author left description empty** |
| `tags` | `artifact_tags` table — merged with any tags you set manually |

Both feed **⌘K search**, Home cards, and link-preview fallbacks. Re-publishing unchanged HTML is a no-op (`auto_summary_hash` dedupes). An hourly drip backfill generates summaries for pages published before this feature shipped.

Authors can always override description and tags in the Inspector or via `PATCH /v1/artifacts/{id}`.

## Link Previews (Slack, WhatsApp, iMessage)

When someone pastes a ShareOut URL in Slack, WhatsApp, iMessage, LinkedIn, or X, the app shows a **link preview** (also called **link unfurling** or **Open Graph metadata**). ShareOut injects preview tags on the **serve wrapper** at `/a/{slug}/` — not inside the sandboxed iframe — so crawlers can read them without running JavaScript.

### What appears in the preview

| Field | Source (priority order) |
|-------|-------------------------|
| **Title** | `social_title` → artifact `name` → URL slug |
| **Description** | `social_description` → artifact `description` |
| **Image** | `social_image_url` → generated/uploaded thumbnail → ShareOut brand image |

### Option 1: Set metadata in artifact HTML (recommended)

Add Open Graph tags to the entrypoint `<head>`. ShareOut **extracts these on every HTML publish** and stores them as `social_*` fields:

```html
<head>
  <title>Q4 Sales Review</title>
  <meta name="description" content="Weekly metrics for the sales team">

  <!-- Link preview (Open Graph) -->
  <meta property="og:title" content="Q4 Sales Review">
  <meta property="og:description" content="Weekly metrics for the sales team">
  <meta property="og:image" content="$ORIGIN/v1/data/.../blobs/hero.png">

  <!-- X / Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Q4 Sales Review">
  <meta name="twitter:description" content="Weekly metrics for the sales team">
  <meta name="twitter:image" content="$ORIGIN/v1/data/.../blobs/hero.png">
</head>
```

**Parsing order:** `og:*` → `twitter:*` → `<title>` / `meta description`.

**Image URLs must be absolute** (`https://...`). Relative paths in `og:image` are resolved against the ShareOut base URL. For blob assets, use the full blob URL from `sdk.blobs`.

**Important:** Tags inside the artifact iframe alone are **not** enough — ShareOut copies extracted values into the outer page `<head>` at serve time. Republish after changing HTML meta tags.

### Option 2: Auto-generated thumbnail

On HTML publish, ShareOut captures a screenshot (1200×750 webp) in the background and uses it as `og:image` when no `social_image_url` is set.

```http
POST /v1/artifacts/{artifact_id}/screenshot
Authorization: Bearer {token}
```

```json
{ "success": true, "thumbnail_url": "/t/art_abc123.webp?v=1710000000000" }
```

### Option 3: Upload a custom thumbnail

```http
PUT /v1/artifacts/{artifact_id}/thumbnail
Authorization: Bearer {token}
Content-Type: image/webp
```

Serve at `GET /t/{artifact_id}.webp` (also used as preview image). See [SKILL.md § Thumbnails](../../SKILL.md#thumbnails).

### Option 4: Override via API

```http
PATCH /v1/artifacts/{artifact_id}
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "social_title": "Q4 Sales Review",
  "social_description": "Weekly metrics for the sales team",
  "social_image_url": "$ORIGIN/t/art_abc123.webp"
}
```

`GET /v1/artifacts/{id}` returns `social_title`, `social_description`, `social_image_url`, and `thumbnail_url`.

### Preview image guidelines

- **Recommended size:** 1200×630 px (or 1200×750 — ShareOut screenshots use this)
- **Formats:** webp, png, jpeg
- **Must be publicly reachable** — crawlers do not authenticate

### Module notes

- **Slides / dashboards:** set `og:title` and `og:description` in the deck HTML; first-slide screenshots become the default image
- **CSV / JSON / Markdown:** previews use artifact `name`, `description`, and thumbnail — HTML meta tags do not apply
- **Private artifacts:** preview metadata is still served; the link itself may require sign-in

## Monitoring & stats

After publish, owners on **Pro or Teams** can track engagement:

| Surface | What it shows |
| --- | --- |
| Home → **Analytics** sidebar | Account roll-up: views, uniques, trend, top artifacts, countries, referrers, load-time p75 |
| Home artifact detail | Per-artifact views and uniques |
| Viewer toolbar (signed-in owner) | Quick stats popover |

API: `GET /v1/home/analytics?range=` and `GET /v1/artifacts/{id}/analytics`. See [api/artifacts.md](../../api/artifacts.md#analytics).

## Related

- [Permissions](permissions.md) - Who can publish
- [Versions](versions.md) - Publish creates version
- [SKILL.md § Thumbnails](../../SKILL.md#thumbnails) - Upload and serve thumbnails
- [api/artifacts.md](../../api/artifacts.md) - REST fields and screenshot endpoint
- [team/publish-governance.md](../../team/publish-governance.md) - Teams member approval before open visibility
