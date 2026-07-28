# REST API: Artifacts

Publish, serve, and manage artifacts.

## POST /v1/publish

Create or update an artifact.

**Request:**
```json
{
  "name": "My App",
  "slug": "my-app",
  "entrypoint": "index.html",
  "files": [
    {
      "path": "index.html",
      "content": "<!DOCTYPE html>...",
      "mime": "text/html",
      "encoding": "utf8"
    }
  ],
  "visibility": "public",
  "pwa": {
    "enabled": true,
    "name": "My App",
    "short_name": "App",
    "icon": "data:image/png;base64,..."
  }
}
```

**Response:**
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
    "installable": true
  },
  "editor_readiness": {
    "manifest": "valid",
    "outline": true,
    "counts": { "pages": 3, "bindings": 12, "templates": 1 },
    "summary": { "errors": 0, "warnings": 1, "infos": 0 },
    "findings": [
      {
        "rule": "binding-undeclared",
        "level": "warning",
        "message": "Binding \"json:revenue\" references undeclared json \"revenue\"",
        "suggestion": "Declare \"revenue\" in the manifest sources",
        "disables": "inline editing and formatting of this value"
      }
    ]
  }
}
```

**Moderation hold** (`moderation`, present **only** when a public publish was held): a public page runs an automated safety check at publish. When it isn't cleared instantly the publish still succeeds (201) but the page is kept **private** — `visibility` is `"private"`, `visibility_downgraded` is `true`, and a `moderation` object is returned:

```json
{
  "visibility": "private",
  "visibility_downgraded": true,
  "requested_visibility": "public",
  "moderation": {
    "status": "pending",
    "reason": "unknown domain example.com",
    "message": "Public pages get an automated safety check at publish. This one is held private for now — it is re-checked automatically within the hour (our team is alerted too) and goes public by itself once it clears.",
    "requested_visibility": "public"
  }
}
```

When `moderation.status === "pending"`, tell the user their page is **under an automated safety review** — it usually clears within the hour and **goes public automatically**, no action needed. Do **not** present the URL as live/public yet; share it as "publishing shortly" or offer the private link. When `status === "blocked"`, the page stays private and needs support. Absent means the page published at the requested visibility.

**Editor-readiness** (`editor_readiness`, HTML artifacts only): an **advisory** profile of how much the visual editor can do with this artifact, computed from the same rules the editor runs in the browser. It **never blocks publishing** — the artifact is live regardless. The more structural markers it carries (manifest, `data-shareout-page`, declared bindings, templates), the more the editor can offer (outline navigation, inline editing, add/remove items). Each finding's `disables` says which editor feature that gap costs. Surface a short summary to the user after publishing (e.g. "Published ✅ — editor-ready, 1 advisory warning"), so they know what they'd gain by adding the missing markers, but don't treat it as an error. Absent for non-HTML artifacts. See [core/html-spec/overview.md](../core/html-spec/overview.md).

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name |
| `slug` | string | No | Human-facing slug (auto-generated from `name` if omitted). Unique **per workspace** (or per owner for personal artifacts). Drives subdomain/namespaced URLs and publish dedup. |
| `entrypoint` | string | No | Default: `index.html` |
| `files` | FileEntry[] | Yes | Files to publish |
| `visibility` | string | No | `private` (default; owner + explicitly shared), `workspace` (all members of the artifact's workspace), `public` (anyone on the internet with the link; discoverable). (`unlisted` is a retired legacy alias, still accepted and treated as `public`.) |
| `mobile_html` | string | No | Mobile-specific HTML |
| `pwa` | PWAConfig | No | PWA configuration |
| `access_policy` | object | No | Row-level access policy (per-viewer data filtering) |
| `agent` | object | No | Enable + configure the AI chat agent in one step (see below) |

**`agent` block** (turns on the visitor chat agent without a separate config call):

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Turn the agent on/off (default `true` when the block is present) |
| `systemPrompt` | string | Visitor system prompt |
| `model` | string | e.g. `claude-sonnet-4-20250514` |
| `maxTokens` / `temperature` | number | Generation settings |
| `contextJson` | boolean | Include `sdk.json` in context (default `true`) |
| `contextTables` | string[] | Table names to auto-include in context |

See [agents/overview.md](../agents/overview.md) for the full agent guide and the live-data `chat({ context })` pattern.

## Slugs: human vs routing

ShareOut stores two slugs per artifact:

| Field | Scope | Used for |
|-------|-------|----------|
| **Human slug** (`display_slug`, set via publish `slug`) | Unique per workspace (or per owner for personal artifacts) | Subdomain URLs (`{ws}.example.com/{slug}`), namespaced URLs (`/@{ws}/{slug}`), publish dedup |
| **Routing slug** (`artifacts.slug`, returned as `deployment.slug`) | Globally unique platform-wide | Canonical `/a/{slug}/`, embed URLs, KV caches |

**Publish behavior:**

- Re-publishing with the same `slug` in the same workspace updates the existing artifact (matched on `display_slug`, not folder).
- Two different workspaces can each publish `slug: "my-report"` — both succeed.
- If the human slug is already taken as a **routing** slug by another workspace's artifact, the new artifact's `deployment.slug` is suffixed (e.g. `my-report-a1b2c3`) while subdomain/namespaced URLs keep the clean human slug.
- **Presenting the URL to a user:** for **workspace** artifacts, share `deployment.subdomain_url` (clean `https://{workspace}.example.com/{slug}/`). Do **not** surface the apex `deployment.url` (`/a/{routing-slug}/`) for workspace artifacts — it's an internal routing key that may be suffixed and ugly. For personal (non-workspace) artifacts, `deployment.url` is the share URL.
- Use `deployment.slug` / `deployment.url` only for canonical/machine links (manifests, embeds, KV) — stable identifiers, not the human share link.

**Example:** workspace A and B both publish `slug: "dashboard"`. Workspace B's response returns `deployment.slug: "dashboard-f3a91b"` and `deployment.url: ".../a/dashboard-f3a91b/"`, but the URL to share is `deployment.subdomain_url: "https://workspace-b.example.com/dashboard/"`.

## GET /a/{slug}/

Serve artifact entrypoint (live viewer). This is the **canonical share URL** returned in `deployment.url` from `POST /v1/publish`.

**Mobile Detection:** Auto-serves mobile version if available. Override with `?v=mobile` or `?v=web`.

## GET /a/{slug}/edit

Serve the visual studio (Agent / Inspect / Data rail). Requires a session; owner or editor role.

Unauthenticated requests redirect to `/auth/google?redirect=/a/{slug}/edit`.

Editor REST routes are mounted under `/v1/artifacts/{id}/editor/*` (draft, publish, chat, collaboration WebSocket). See [core/editor.md](../core/editor.md).

## GET /p/{slug}/

Serve artifact entrypoint — alias of `/a/{slug}/` (same viewer pipeline). Common in slides/dashboards module docs.

## GET /a/{slug}/{path}

Serve specific asset.

## GET /a/{slug}/{path}?_raw

Serve raw content (for iframe embedding).

## GET /v1/artifacts/{id}/files

Fetch all files for an artifact version.

**Required Role:** `viewer` or higher

**Query Parameters:**
- `version` (optional): Version number or ID

**Response:**
```json
{
  "artifact_id": "art_abc123",
  "version_id": "ver_xyz789",
  "files": [
    {
      "path": "index.html",
      "content": "<!DOCTYPE html>...",
      "encoding": "utf8",
      "mime": "text/html",
      "size_bytes": 1234
    }
  ]
}
```

## Collaborator API

Every route below accepts the artifact's own roles (owner / editor / viewer as noted)
**or** an owner/admin of the workspace the artifact belongs to. Workspace admins govern
sharing — invite list, ownership, access queue — for any page in their workspace; this
does not give them content access to a member's private page.

### GET /v1/artifacts/{id}/collaborators

List all collaborators.

### POST /v1/artifacts/{id}/collaborators

Add collaborators.

```json
{
  "emails": ["user@example.com"],
  "role": "editor"
}
```

### DELETE /v1/artifacts/{id}/collaborators/{email}

Remove collaborator.

### POST /v1/artifacts/{id}/transfer-ownership

Transfer ownership (artifact owner, or a workspace owner/admin). The new owner must be
an **internal** member — an external (Sharee) identity can never own an artifact.

```json
{ "email": "newowner@example.com" }
```

### POST /v1/artifacts/{id}/share

Email the page to up to 10 recipients, optionally granting them a role.

```json
{ "recipients": ["peer@example.com"], "role": "viewer", "message": "for review" }
```

`role: "none"` sends the notification without granting anything and needs `viewer`
access; granting a role needs `editor`. `message` is an editor-level field — a viewer
may pass the page along, but the free-text note is dropped from their send. Recipients
are granted only after the daily email limit check passes, so a `429` grants nothing.

## Favorites API

Per-user starred artifacts. Favorites are private to each user — they do not affect other users or visibility. Any logged-in user can favorite an artifact they can view: this includes any **public** or **workspace** artifact (so viewers of someone else's published artifact can star it too), while **private** artifacts still require `viewer` access.

The favorite star appears for logged-in users in three places: the dashboard artifact cards, the live editor toolbar, and the artifact viewer toolbar shown on `/a/{slug}/`.

### POST /v1/artifacts/{id}/favorite

Add the artifact to the current user's favorites. Idempotent.

**Access:** any logged-in user for public/workspace artifacts; `viewer`+ for private artifacts.

**Response:**
```json
{ "success": true, "artifact_id": "art_abc123", "favorited": true }
```

### DELETE /v1/artifacts/{id}/favorite

Remove the artifact from the current user's favorites. Idempotent.

**Response:**
```json
{ "success": true, "artifact_id": "art_abc123", "favorited": false }
```

### GET /v1/artifacts?favorites=true

List only the current user's favorited artifacts. Same response shape as `GET /v1/artifacts`; each artifact includes `is_favorite`.

### GET /v1/artifacts?workspace_id={id}

List the artifacts that belong to a workspace (not the caller's personal artifacts). The caller must be a member of the workspace; non-members get `403`.

- **Owners/admins** see every artifact in the workspace, including workspace-owned ones with no individual `owner_id` and other members' private artifacts.
- **Members** see non-private artifacts plus any they own or collaborate on.

Without this param, `GET /v1/artifacts` lists everything the caller owns or collaborates on across all workspaces. Same response shape either way.

### Pagination (`limit`, `offset`, `has_more`, `count`)

`GET /v1/artifacts` accepts `limit` (default 50, max 100) and `offset`. The response always includes `has_more: boolean` — derived from a `limit + 1` probe, so paging never scans your full library. An exact `total` is **opt-in**: pass `?count=true` to also get `total` (a count over your whole artifact set). The default path omits `total` to keep the list fast for large accounts.

To delete a workspace-owned artifact (`owner_id` is null), the caller must be an owner/admin of its workspace — see `DELETE /v1/artifacts/{id}`.

## Delete & restore (trash)

Deleting an artifact is a **soft delete** with a 30-day recovery window — not an immediate purge. The artifact is hidden everywhere (listings, home, serve paths all stop resolving it) and its routing slug is freed so you can re-publish the same slug, but its files, versions, and data store are kept intact so it can be fully restored. A daily cron sweep hard-purges artifacts whose retention window has elapsed.

### DELETE /v1/artifacts/{id}

Move an artifact to trash. The caller must be the owner, or an owner/admin of the artifact's workspace.

**Response:**
```json
{
  "success": true,
  "deleted": "art_abc123",
  "deleted_at": "2026-06-20T18:00:00.000Z",
  "recoverable_until": "2026-07-20T18:00:00.000Z",
  "retention_days": 30,
  "restore_url": "$ORIGIN/v1/artifacts/art_abc123/restore",
  "message": "Artifact moved to trash. Recoverable for 30 days, then permanently deleted."
}
```

### GET /v1/artifacts/deleted

List the caller's soft-deleted artifacts still inside the recovery window (their own, plus workspace-owned ones where they're an owner/admin). Each entry includes `deleted_at` and `recoverable_until`.

### POST /v1/artifacts/{id}/restore

Restore a soft-deleted artifact. Clears the deletion, allocates a fresh routing slug (suffixed if the original was reclaimed by a re-publish in the meantime), recreates the production deployment from the latest version, and returns the artifact detail. Returns `400 NOT_DELETED` if the artifact isn't in trash, `409 NO_VERSION` if it has no version to serve. After 30 days the artifact is permanently purged and no longer restorable.

## PATCH /v1/artifacts/{id}

Update artifact metadata. Requires owner or editor access.

```http
PATCH /v1/artifacts/{id}
Authorization: Bearer {token}
Content-Type: application/json
```

Common fields:

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | Display name |
| `description` | string | Short description |
| `visibility` | string | `private`, `workspace`, `public` |
| `access_policy` | object | Row-level access policy — see [core/access-policy.md](../core/access-policy.md) |
| `social_title` / `social_description` / `social_image_url` | string \| null | Link preview overrides |
| `allow_anon_write` | boolean | Let anonymous visitors mutate json/tables/blobs/datasets on public artifacts |
| `allow_anon_email` | boolean | Let anonymous visitors send outbound email |
| `allow_anon_agent` | boolean | Let anonymous visitors use in-artifact AI chat |
| `allow_anon_collab` | boolean | Let anonymous visitors join realtime collaboration |

All `allow_anon_*` flags default to `false`. See [modules/_shared/publishing.md](../modules/_shared/publishing.md#public-artifacts-read-only-by-default).

**Paid visibility gate.** Public visibility requires a paid plan or paid Teams workspace. Free accounts get `notice` on publish or `VISIBILITY_HELD` on PATCH — see [modules/_shared/publishing.md](../modules/_shared/publishing.md).

Transitioning **into** `public` may run an automated content-safety check. If it isn't cleared instantly, PATCH returns `202` with `code: "MODERATION_HELD"`, a `reason`, and the artifact stays `private` — but it is re-checked automatically within the hour and goes public by itself once it clears (no re-publish needed).

## Viewer toolbar (ShareOut chrome)

Logged-in viewers see a floating ShareOut toolbar on `/a/{slug}/` (favorite, edit link, schedule delivery, notify-me, **Skills** when attachments exist, etc.). The **schedule** button opens a modal to create recurring delivery via **email**, **Slack**, or **Telegram** — no API calls needed. When an artifact has attached skills (Teams workspace), signed-in viewers see a **Skills N** button that opens a read-only popover linking to each skill — skills do not load into visitor chat. Owners and editors can schedule to other recipients; viewers with access can subscribe to delivery **to themselves** only (their own inbox, Slack DM, or linked Telegram chat). Jobs created from the toolbar use the same `POST /v1/jobs` actions documented in [jobs.md](jobs.md). Owners can tune the toolbar from its admin menu or by writing the reserved JSON key `_viewer_config`:

```json
{
  "hide_toolbar": false,
  "show_on_mobile": false
}
```

| Field | Default | Effect |
|-------|---------|--------|
| `hide_toolbar` | `false` | When `true`, the toolbar is not rendered at all |
| `show_on_mobile` | `false` | When `false`, toolbar is hidden on small screens (avoids overlapping artifact FABs); set `true` to show it on phones |

```http
PUT /v1/data/{artifactId}/json/_viewer_config
Authorization: Bearer so_xxx
Content-Type: application/json

{ "hide_toolbar": true }
```

Stored in the artifact mini-store; cached in KV for serve performance.

## Permission Matrix

| Action | Owner | Editor | Viewer |
|--------|-------|--------|--------|
| View | ✓ | ✓ | ✓ |
| Edit | ✓ | ✓ | ✗ |
| Publish | ✓ | ✓ | ✗ |
| Manage collaborators | ✓ | ✓ | ✗ |
| Favorite / unfavorite | ✓ | ✓ | ✓ (+ any logged-in user for public) |
| Delete | ✓ | ✗ | ✗ |
| Transfer ownership | ✓ | ✗ | ✗ |

## Auth Endpoints

### GET /auth/google

Start Google OAuth flow.

### GET /auth/callback

OAuth callback. Sets session cookie.

### GET /auth/logout

Clear session cookie.

### POST /auth/password

Password authentication.

```json
{
  "artifactId": "art_abc123",
  "password": "secret"
}
```

## Link Preview Metadata

ShareOut serves Open Graph / Twitter Card tags on `/a/{slug}/` for link unfurling in Slack, WhatsApp, iMessage, etc.

**Set in HTML** (extracted on publish): `og:title`, `og:description`, `og:image` in the entrypoint `<head>`. See [modules/_shared/publishing.md](../modules/_shared/publishing.md#link-previews-slack-whatsapp-imessage).

**Override via API** on `PATCH /v1/artifacts/{id}`:

| Field | Type | Description |
|-------|------|-------------|
| `social_title` | string \| null | Preview title override |
| `social_description` | string \| null | Preview description override |
| `social_image_url` | string \| null | Absolute image URL for previews |

`GET /v1/artifacts/{id}` also returns `thumbnail_url` when a thumbnail exists.

### POST /v1/artifacts/{id}/screenshot

Regenerate the preview thumbnail (headless browser screenshot, 1200×750 webp). Requires editor access. Used as `og:image` when `social_image_url` is not set.

```json
{ "success": true, "thumbnail_url": "/t/art_abc123.webp?v=1710000000000" }
```

### PUT /v1/artifacts/{id}/thumbnail

Upload a custom thumbnail (max 500KB, webp/png/jpeg). See [SKILL.md § Thumbnails](../SKILL.md#thumbnails).

## Analytics

View counts and performance for published artifacts. Requires `advanced_analytics` on the account tier (Pro or Teams).

### Account roll-up

Home sidebar **Analytics** (or `#analytics`) shows a roll-up across all artifacts the user owns: total views, unique visitors, active artifacts, load-time p75 (LCP once 20+ samples exist), trend chart, top artifacts, top countries, and referrers.

```http
GET /v1/home/analytics?range=30
Authorization: Bearer {token}
```

`range` — days to include (`7`, `30`, or `90`; default `30`).

Response includes `totals`, `prev` (prior-period comparison), `series` (daily views/uniques), `topArtifacts`, `topCountries`, `topReferrers`, and `perf` (p75 LCP/FCP/DCL/TTFB when enough samples).

### Per-artifact stats

```http
GET /v1/artifacts/{id}/analytics?range=7
Authorization: Bearer {token}
```

Owner or editor only. Returns `totalViews`, `uniqueVisitors`, daily breakdown, top referrers, top countries, and **`viewerTracking`** — per-viewer rows for every invited collaborator or authenticated viewer (email, display name, role, `hasViewed`, `firstViewedAt`, `lastViewedAt`, `viewCount`). The artifact owner is excluded. Also surfaced in Home artifact detail, the viewer toolbar for signed-in owners, and the Inspector **Details** tab.

### Live concurrent viewers

Best-effort count of viewers with the artifact tab open right now (heartbeat every ~20s while visible). Owner or collaborator only.

```http
GET /v1/artifacts/{id}/presence
Authorization: Bearer {token}
```

**Response (200):**

```json
{ "count": 3 }
```

Anonymous viewers are counted via a lightweight beacon injected into served HTML (`POST /v1/presence`); the read API is authenticated for owners/editors only.

## Export ("your data is yours")

One-click, no-lock-in export. Returns a `.zip` (store-only) — hit either URL from a
browser (session cookie) or with a Bearer token.

### Export one artifact

```http
GET /v1/artifacts/{id}/export
Authorization: Bearer {token}
```

Artifact **owner or workspace admin** only. The zip contains:

- `source/…` — the published source files (HTML + assets) of the current production version, at their original paths.
- `data/json/{key}.json` — every JSON key stored via `so.json`.
- `data/tables/{name}.csv` — every table stored via `so.table`, one CSV per table (column union across rows).
- `manifest.json` — `{ id, title, slug, version, exported_at }`.

### Export a whole workspace

```http
GET /v1/workspaces/{id}/export
Authorization: Bearer {token}
```

Workspace **owner or admin** only. Zip of every (non-deleted) artifact in the
workspace, each under its own `{slug}/` folder with the same `source/`, `data/`,
and `manifest.json` layout as above. Capped at 200 artifacts — above that, returns
`413 TOO_MANY_ARTIFACTS`; export artifacts individually instead.

### Present this (AI slides deck)

```http
POST /v1/artifacts/{id}/present
Authorization: Bearer {token}
```

Any caller who can access the source artifact (owner, editor, or workspace member) may generate a **sibling slides deck**. ShareOut reads the production HTML, asks the model for a slide outline, renders a reveal.js deck, and publishes it as a **new private** HTML artifact in the same workspace. Returns `{ "artifact_id", "url" }` with `201`. Rate limit: **10 per user per UTC hour**. See [../core/workspace-home.md](../core/workspace-home.md#present-this-ai-deck).

### Unused-page cleanup (archive all)

Monthly **janitor** cards in Needs You (and email) flag published pages nobody opened in **90+ days**. One-click **Archive all** soft-deletes them into the 30-day trash:

```http
POST /v1/workspaces/{id}/unused/archive
Authorization: Bearer {token}
```

Workspace **owner or admin** only.

```http
POST /v1/artifacts/unused/archive
Authorization: Bearer {token}
```

Personal home — archives your own unused personal pages.

## PWA Endpoints (when enabled)

| URL | Purpose |
|-----|---------|
| `/a/{slug}/manifest.json` | Web app manifest |
| `/a/{slug}/sw.js` | Service worker |
| `/a/{slug}/_pwa/icon-{size}.png` | App icons |

## Related

- [Overview](overview.md) - API intro
- [Blobs](blobs.md) - File storage
- [SDK: Collaborators](../modules/_shared/permissions.md) - SDK access
