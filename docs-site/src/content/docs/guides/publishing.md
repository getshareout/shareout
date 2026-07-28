---
title: Publishing artifacts
description: Create, update, version, and share artifacts.
---

import { Aside } from '@astrojs/starlight/components';

An artifact is a versioned bundle of files served at a live URL. Publishing the
same `slug` again creates a new version — the old ones stay reachable.

## Publish

`POST /v1/publish` with your files:

```json
{
  "name": "My App",
  "slug": "my-app",
  "entrypoint": "index.html",
  "visibility": "public",
  "files": [
    { "path": "index.html", "content": "<!DOCTYPE html>…", "mime": "text/html", "encoding": "utf8" }
  ]
}
```

Omit `slug` and ShareOut generates one. See the full schema in the
[API reference](/api/operations/publishartifact/).

## Share URLs

The publish response includes a `deployment` object with live URLs:

| Field | Use |
| --- | --- |
| `deployment.subdomain_url` | **Share link for workspace artifacts** — `https://{workspace}.shareout.site/{slug}/` |
| `deployment.url` | Share link for **personal** artifacts (`https://shareout.site/a/{slug}/`); also the internal routing key for workspace artifacts |
| `deployment.slug` | Globally unique routing slug (may differ from the human slug you sent) |
| `deployment.mobile_url` | Mobile entrypoint when `mobile_html` is set |

For **workspace** artifacts, present `deployment.subdomain_url` to users — not the apex
`/a/{routing-slug}/` URL. The apex slug is an internal routing key that may be
hash-suffixed on cross-workspace collision; subdomain and namespaced URLs keep the clean
human slug. Use `deployment.url` only for machine links (embeds, manifests, KV).

## Editor readiness

HTML publishes return an **advisory** `editor_readiness` profile — how much the visual
editor can do with the artifact. Publishing is **never blocked** by gaps; the page is live
regardless.

```json
{
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

Each finding's `disables` field names which studio feature that gap costs. Absent for
non-HTML artifacts. Findings may include a `category` — e.g. `provenance` warns when
a live source has no `query`/`description` or when charts lack
`data-shareout-source` / manifest `feeds` links. See [Data provenance](/guides/data-provenance/).

See the [artifact spec overview](/spec/overview/) and
[visual editor](/spec/editor/) for the full checklist.

## Visibility

| Value | Who can view |
| --- | --- |
| `private` | Only collaborators with `viewer`+ |
| `workspace` | Any member of the artifact's workspace |
| `public` | Anyone on the internet with the link; discoverable |

(`unlisted` is a retired legacy alias, still accepted on the API and treated as `public`.)

### Public artifacts

Public visibility triggers additional platform rules:

**Safety review.** The first time you publish or switch to open visibility, ShareOut
runs an automated safety check on the HTML. If it cannot approve instantly, the
artifact stays **private** with `moderation_status: "pending"` and a `moderation`
object on publish (or `code: "MODERATION_HELD"` + `reason` on PATCH) — but ShareOut
**re-checks pending holds automatically** (hourly) and restores the requested public
visibility once cleared, so most cases resolve within an hour with no action needed.
Blocked artifacts return HTTP 451 and are not served.

Owners see **Under review** / **Blocked** badges on Home cards and an inspector banner
while held. Visitors who open a held public URL see a dedicated under-review page (not
the artifact content). When a hold clears, the owner gets a bell notification and email.

**External scripts & CDNs.** On `public` artifacts the sandbox
Content-Security-Policy allows scripts, styles and fonts from a broad allowlist of
reputable CDNs — jsDelivr, unpkg, cdnjs, esm.sh, Skypack, Google-hosted libraries,
the Tailwind Play CDN (`cdn.tailwindcss.com`), jQuery, D3, Plotly, Highcharts,
DataTables, Bootstrap and more — which covers most libraries. A CDN **outside** the
allowlist is blocked, and its `<script>` will fail to load. If your artifact loads a
non-allowlisted CDN, trying to make it public is **refused** — it stays
private and you get a message naming the offending host.

**Private artifacts have no CDN restriction.** A `private` artifact can load
scripts, styles and fonts from **any** HTTPS source. So for a niche or self-hosted
CDN, keep the artifact **private** and add collaborators individually
(Settings → Sharing): they get full access and you keep unrestricted CDN use.
Alternatively, self-host the library as a file inside the artifact, or switch to an
allowlisted CDN.

**Anonymous visitors are read-only by default.** On public artifacts, anonymous
viewers cannot write to json/tables/blobs/datasets, send email, use the visitor AI
chat, or join realtime collaboration unless the owner opts in per capability:

| PATCH field | Allows anonymous visitors to… |
| --- | --- |
| `allow_anon_write` | Mutate json, tables, blobs, datasets |
| `allow_anon_email` | Send contact-form email |
| `allow_anon_agent` | Use the in-artifact AI chat agent |
| `allow_anon_collab` | Join realtime/Y.js collaboration |

All default to `false`. Authenticated collaborators keep their normal roles.

**Badge.** Off by default. Set `ARTIFACT_BADGE=1` on the Worker to add a small
"Made with ShareOut" badge with a Report link to public artifacts.

**Storage quota.** Publishing checks the owner's total stored bytes against
`STORAGE_QUOTA_BYTES`; exceeding it returns `413 STORAGE_LIMIT_EXCEEDED`. Unset
or `0` means unlimited, the default.

<Aside type="tip">
Open (public) visibility is on unless the instance sets
`OPEN_VISIBILITY_DISABLED`. Where it is off, `POST /v1/publish` and
`PATCH /v1/artifacts/{id}` return a `notice` (publish) or `VISIBILITY_HELD`
(update) instead of silently reverting. See [Public artifacts
policy](/public-artifacts/overview/#who-can-publish-publicly).
</Aside>

### Workspace publish governance

Workspace owners and admins can gate open visibility with a per-workspace policy
(`allow` / `prohibit` / `require_approval`). Default is `allow` — no change from
today unless configured. See [Public artifacts policy](/public-artifacts/overview/)
for the full policy context.

**Configure (admin/owner):**

```http
GET  /v1/workspaces/{id}/publish-policy
PATCH /v1/workspaces/{id}/publish-policy
```

```json
{ "policy": "require_approval", "approvals_required": 2 }
```

`approvals_required` is `1`–`10` when policy is `require_approval`.

**When a member publishes or PATCHes visibility to open**, the gate runs before
platform moderation:

| Policy | API behaviour |
| --- | --- |
| `prohibit` | Visibility forced to `workspace`; response includes a `notice`. |
| `require_approval` | Visibility forced to `workspace`; response includes `notice` and `approval_required`. |

```json
{
  "deployment": { "url": "…" },
  "notice": "Your workspace requires approval to publish publicly. Kept visible to your workspace — request approval from 2 teammate(s).",
  "approval_required": { "required": 2, "artifact_id": "art_abc123" }
}
```

**Request approval** (requester nominates exactly N workspace members, not self):

```http
POST /v1/artifacts/{id}/publish-approval
{ "visibility": "public", "approver_ids": ["usr_a", "usr_b"] }
```

**Approve or reject** (each nominated approver):

```http
POST /v1/artifacts/{id}/publish-approval/{requestId}/decision
{ "decision": "approve" }
```

**List pending requests** (any workspace member):

```http
GET /v1/workspaces/{id}/publish-approvals?status=pending
```

When all nominated approvers approve, visibility flips to the requested level and
the automated safety review runs. Any rejection cancels the request. Approval is
per content hash — unchanged re-publishes stay approved.

## Collaborators

Add people by email with a role:

```bash
curl -X POST https://shareout.site/v1/artifacts/art_abc123/collaborators \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "emails": ["teammate@example.com"], "role": "editor" }'
```

| Action | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| View | ✓ | ✓ | ✓ |
| Edit & publish | ✓ | ✓ | ✗ |
| Manage collaborators | ✓ | ✓ | ✗ |
| Delete | ✓ | ✗ | ✗ |
| Transfer ownership | ✓ | ✗ | ✗ |

## Link previews

Set `og:title`, `og:description`, and `og:image` in your entrypoint `<head>` and
ShareOut serves them for Slack, WhatsApp, and iMessage unfurls. Override per
artifact with `PATCH /v1/artifacts/{id}` (`social_title`, `social_description`,
`social_image_url`).

<Aside type="tip">
Regenerate the preview thumbnail any time with
`POST /v1/artifacts/{id}/screenshot` — a headless screenshot used as the default
`og:image`.
</Aside>

## Serving

| URL | Serves |
| --- | --- |
| `/a/{slug}/` | Entrypoint (auto mobile detection) |
| `/a/{slug}/{path}` | A specific asset |
| `/a/{slug}/{path}?_raw` | Raw content for iframe embedding |

## Auto-summary & tags

After each successful HTML publish, ShareOut runs a **background** AI pass over the
production entrypoint. It writes a 1–2 sentence **description** (only when you left
the field empty) and **3–6 tags** into the existing `artifact_tags` table. Publish
never waits on this job — if AI is unavailable, the page still goes live.

Auto-summaries power Home card subtitles, ⌘K search hits, the [weekly workspace
digest](/everyone/your-workspace/#notifications), and Knowledge learner input.
Older pages published before this feature shipped are backfilled on an hourly drip.

Set your own description or tags any time with `PATCH /v1/artifacts/{id}` — your
values are kept; auto-summary only fills gaps.

## Deleting & restoring

Deleting an artifact is a **soft delete** with a 30-day recovery window — not an
immediate purge:

```bash
curl -X DELETE https://shareout.site/v1/artifacts/art_abc123 \
  -H "Authorization: Bearer $TOKEN"
# → { "recoverable_until": "...", "retention_days": 30, "restore_url": "..." }
```

The artifact stops serving and disappears from your listings, and its slug is
freed so you can re-publish the same slug — but its files, versions, and data
store are kept intact. Within 30 days you can bring it back:

```bash
curl https://shareout.site/v1/artifacts/deleted -H "Authorization: Bearer $TOKEN"   # trash
curl -X POST https://shareout.site/v1/artifacts/art_abc123/restore \
  -H "Authorization: Bearer $TOKEN"                                                  # restore
```

In the home UI, the same lives under the account menu → **Recently deleted**.
Restoring re-derives a fresh slug if the original was reclaimed in the meantime.

### Unused-page janitor

Once a month (per workspace or personal account), ShareOut flags **published pages
with zero views in 90+ days** when there are at least three of them. Starred pages
are always kept. The bell shows an **Unused pages** card with sample titles and
**Archive all** — a one-click soft-delete into the same 30-day trash (batches of
100 per click). Workspace admins use `POST /v1/workspaces/{id}/unused/archive`;
personal accounts use `POST /v1/artifacts/unused/archive`.

<Aside type="caution">
After 30 days a daily sweep **permanently purges** the artifact — files, data, and
all. Past that point it can't be restored.
</Aside>

