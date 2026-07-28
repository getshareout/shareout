---
title: Teams API reference
description: Full endpoint list for Teams plan workspace management.
---

All write and admin endpoints require:

```http
Authorization: Bearer {token}
```

Some workspace reads also accept a logged-in browser session.

## Workspaces

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces` | List workspaces the token's user belongs to. |
| `POST` | `/v1/workspaces` | Create a workspace. |
| `GET` | `/v1/workspaces/{id}` | Get workspace, including a `seats` object (`used`/`limit`/`remaining`). Member+. |
| `PATCH` | `/v1/workspaces/{id}` | Update name, slug, settings. Admin+. |
| `POST` | `/v1/workspaces/{id}/logo` | Upload workspace logo (image). Admin+. |
| `DELETE` | `/v1/workspaces/{id}/logo` | Remove workspace logo. Admin+. |
| `DELETE` | `/v1/workspaces/{id}` | Delete workspace. Owner only. |
| `GET` | `/v1/workspaces/by-slug/{slug}` | Look up by slug. |

## Members

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/members` | List members. |
| `POST` | `/v1/workspaces/{id}/members` | Add member; policy-gated. |
| `DELETE` | `/v1/workspaces/{id}/members/{userId}` | Remove member. |
| `POST` | `/v1/workspaces/{id}/members/invite` | Bulk invite by email. Admin+. |
| `GET` | `/v1/workspaces/{id}/members/metrics` | Activity metrics. Admin+. |
| `GET` | `/v1/workspaces/{id}/invites` | Pending email invites. Admin+. |
| `DELETE` | `/v1/workspaces/{id}/invites/{inviteId}` | Revoke pending invite. Admin+. |
| `GET` | `/v1/workspaces/{id}/people` | People picker list. |
| `POST` | `/v1/workspaces/{id}/transfer-ownership` | Transfer to another member. Owner only. |
| `POST` | `/v1/workspaces/{id}/members/{userId}/tokens` | Create API token for member. Admin+. |
| `DELETE` | `/v1/workspaces/{id}/members/{userId}/tokens` | Revoke tokens for member. Admin+. |

## Agent tokens (service accounts)

Non-human, workspace-scoped credentials (prefix `sot_`) for a customer's AI agent,
a backend service, or CI/CD. Each token authenticates as a **service principal** — a
headless first-class member that owns the artifacts it publishes and is confined to its
one workspace. Action scopes: `artifacts:read`, `artifacts:publish`, `data:read`,
`data:write`.

| Method | Endpoint | Notes |
| --- | --- | --- |
| `POST` | `/v1/workspaces/{id}/agent-tokens` | Mint. Body `{ name, scopes[], expires_at? }`. Returns `sot_…` once. Admin+. |
| `GET` | `/v1/workspaces/{id}/agent-tokens` | List (metadata only). Admin+. |
| `DELETE` | `/v1/workspaces/{id}/agent-tokens/{tokenId}` | Soft-revoke. Admin+. |

A token without a scope gets `403 INSUFFICIENT_SCOPE`; a revoked/expired token gets `401`.

## Membership policy

```http
GET  /v1/workspaces/{id}/access-policy
PUT  /v1/workspaces/{id}/access-policy
```

Body: `{ "allowed_domains": ["example.com"], "allowed_emails": ["x@y.com"] }`.
`PUT` requires `admin` or `owner`. See [Workspaces](/teams/workspaces/#membership-policy).

## Subdomain

```http
GET    /v1/workspaces/{id}/subdomain
POST   /v1/workspaces/{id}/subdomain       ← { "enabled": true }
DELETE /v1/workspaces/{id}/subdomain
```

Requires Teams plan + `admin` or `owner`. See [Subdomains](/teams/subdomain/).

## Branding

```http
GET    /v1/workspaces/{id}/branding
PUT    /v1/workspaces/{id}/branding
POST   /v1/workspaces/{id}/logo
DELETE /v1/workspaces/{id}/logo
```

## Workspace context (agent house style)

```http
GET    /v1/workspaces/{id}/context
PUT    /v1/workspaces/{id}/context                ← { "entry": "index.md" }
GET    /v1/workspaces/{id}/context/{name}
PUT    /v1/workspaces/{id}/context/{name}
DELETE /v1/workspaces/{id}/context/{name}
```

Writes require `admin` or `owner`. See [Workspaces](/teams/workspaces/#workspace-context-files).

## Folders

```http
GET    /v1/workspaces/{id}/folders
POST   /v1/workspaces/{id}/folders
GET    /v1/workspaces/{id}/folders/{folderId}
PATCH  /v1/workspaces/{id}/folders/{folderId}
DELETE /v1/workspaces/{id}/folders/{folderId}
GET    /v1/workspaces/{id}/folders/by-path/{path}
POST   /v1/workspaces/{id}/artifacts/{artifactId}/move
```

See [Folders](/teams/folders/).

## Assets (deliverables)

Per-scope asset library — one hidden bucket per workspace (shared) and one personal bucket. Any workspace member may use the workspace routes; personal routes use `/v1/assets` without a workspace prefix.

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/assets` | List deliverables + loose files (`deliverables[]`, `loose[]`, `bucketId`, `usedBytes`). Member+. |
| `POST` | `/v1/workspaces/{id}/assets/upload` | Request upload → `{ uploadUrl, tokenId }`; `PUT` bytes to `uploadUrl`. Member+. |
| `POST` | `/v1/workspaces/{id}/assets/deliverables` | `{ blobId, name? }` → new deliverable (v1). Member+. |
| `POST` | `/v1/workspaces/{id}/assets/deliverables/{id}/version` | `{ blobId }` → add version. Member+. |
| `PATCH` | `/v1/workspaces/{id}/assets/deliverables/{id}` | `{ visibility?, folderId? }` — `private` \| `workspace`. Member+. |
| `GET` | `/v1/workspaces/{id}/assets/deliverables/{id}/versions` | Version history. Member+. |
| `DELETE` | `/v1/workspaces/{id}/assets/deliverables/{id}` | Delete deliverable + all versions. Member+. |
| `POST` | `/v1/workspaces/{id}/assets/collections` | `{ name?, deliverableIds[] }` → bundle. Member+. |
| `POST` | `/v1/workspaces/{id}/assets/collections/{id}/share` | `{ expiresAt?, gate?, password?, domains? }` → `{ url }` (`/d/<token>`). Member+. |
| `POST` | `/v1/workspaces/{id}/assets/collections/{id}/send` | `{ to, expiresAt?, gate?, password?, domains? }` → email link. Member+. |
| `GET` | `/v1/workspaces/{id}/assets/links` | List sent delivery links (gate, expiry, `viewCount`, revoked). Member+. |
| `POST` | `/v1/workspaces/{id}/assets/links/{linkId}/revoke` | Revoke link (page + bytes 404). Member+. |

`gate`: `none` (default), `password` + `password`, or `domain` + `domains[]`. Protected deliveries stream bytes through `/d/<token>/file/<blobId>` after the gate clears. First open emails the link creator (`asset_delivery_opened`).

Limits: 500 MB/file · 10 GB/bucket · 10 000 files. See [Files & deliverables](/everyone/assets/).

### File content (cross-artifact)

Embed a workspace file in any artifact by its `dlv_` id. Enforces per-file visibility (private files 403 for unauthorized viewers).

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/files/{deliverableId}/content` | Latest version bytes. Session or token; owner, member (workspace files), or sharee grant. |

SDK: [`sdk.files.getUrl('dlv_…')`](/sdk/files/).

## External sharing (Clients)

Teams/Enterprise feature. Share folders and artifacts with client orgs outside your
team — grouped portal, branded pages, scoped API tokens, read receipts, and
private client notes. All routes require workspace `admin` plus the entitlement
(`403 EXTERNAL_SHARING_NOT_ENTITLED` otherwise). See
[External sharing](/teams/external-sharing/).

### Clients

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/sharees` | List client orgs (`member_count`). |
| `POST` | `/v1/workspaces/{id}/sharees` | `{ "name": "Acme", "type": "client" }`. |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}` | One client. |
| `PATCH` | `/v1/workspaces/{id}/sharees/{sid}` | `{ name?, type?, properties?, branding? }` — `branding` is `{ logo, color }` for the portal. |
| `DELETE` | `/v1/workspaces/{id}/sharees/{sid}` | Removes the client, its members, grants, and notes. |

### External members

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}/members` | List external members. |
| `POST` | `/v1/workspaces/{id}/sharees/{sid}/members` | `{ "email": "ext@acme.com" }` — invite; stamps an external membership edge (free, not billed). |
| `DELETE` | `/v1/workspaces/{id}/sharees/{sid}/members/{uid}` | Remove from this client only. |

### Grants

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/grants` | Filter with `?subject_id=` / `?resource_type=` / `?resource_id=`. |
| `POST` | `/v1/workspaces/{id}/grants` | Mint a grant — see body below. |
| `DELETE` | `/v1/workspaces/{id}/grants/{gid}` | Revoke (effective within ~60s of cache). |

**Share with one person** (no client org):

| Method | Endpoint | Notes |
| --- | --- | --- |
| `POST` | `/v1/workspaces/{id}/share-person` | `{ email, resource_type: "file"\|"folder", resource_id, capability: "view"\|"comment" }` — admin + Teams entitlement; invites external user if needed. `409` if email is an internal member. |

Grant body (admin grants API):

```json
{
  "subject_type": "sharee",
  "subject_id": "shr_…",
  "resource_type": "folder",
  "resource_id": "fld_…",
  "capability": "view"
}
```

`resource_type`: `folder` | `artifact` | `file`. `subject_type`: `sharee` (whole client org) or `external_user` (one person).
`capability`: `view` | `comment` | `create` | `edit`. `create` is folder-only —
lets the external author new artifacts fenced inside that folder (forced private).

### Scoped API tokens

External tokens resolve through grants — never workspace-blanket. Scopes limited
to `artifacts:read`, `data:read`, `data:write` (never `artifacts:publish`).

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}/members/{uid}/tokens` | List (no secrets). |
| `POST` | `/v1/workspaces/{id}/sharees/{sid}/members/{uid}/tokens` | `{ "scopes": ["data:read"] }` → `{ token: "sot_…", shown_once: true }`. |
| `DELETE` | `/v1/workspaces/{id}/sharees/{sid}/members/{uid}/tokens/{tid}` | Revoke. |

### Activity / read receipts

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}/activity` | Recent views for one client. |
| `GET` | `/v1/workspaces/{id}/sharee-activity` | Recent views across all clients. |

### Client notes

Workspace-private markdown about a client — never shared with them. Any member
can read; admin (or the workspace assistant via `set_client_notes`) can write.

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}/context` | List note files. |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}/context/{name}` | Read one note (markdown). |
| `PUT` | `/v1/workspaces/{id}/sharees/{sid}/context/{name}` | Create/replace (admin). Raw markdown or `{ "content": "…" }`. |
| `DELETE` | `/v1/workspaces/{id}/sharees/{sid}/context/{name}` | Delete (admin). |

## Workspace connections

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/connections` | Member+ | List. No secrets. |
| `POST` | `/v1/workspaces/{id}/connections` | Admin+ | Create. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Detail. |
| `DELETE` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Delete; cascades member creds. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}/artifacts` | Member+ | Artifacts using this connector. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Per-user status. |
| `PUT` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Save own token. |
| `DELETE` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Remove own token. |
| `GET` | `/v1/workspaces/{id}/connections/{provider}/auth-url` | Admin+ | OAuth start URL. |
| `GET` | `/v1/workspaces/{id}/connections/slack/install` | Admin+ | Slack install (302). |
| `GET` | `/v1/workspaces/{id}/connections/{connection}/slack/channels` | Member+ | Slack channel list. |
| `GET` | `/v1/oauth/slack/callback` | — | Slack OAuth callback. |

See [Connections](/teams/connections/).

## Data catalog

Optional per-workspace data map. See [Data Catalog](/teams/catalog/).

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/catalog` | Member+ | Search (`q`, `kind`, `domain`, `status`, `tag`) + facets. |
| `GET` | `/v1/workspaces/{id}/catalog/manifest` | Member+ | Adoption KPIs, orphans, dangling refs. |
| `GET` | `/v1/workspaces/{id}/catalog/entries/{entryId}` | Member+ | Entry + lineage neighbors. |
| `GET` | `/v1/workspaces/{id}/catalog/lineage` | Member+ | Full graph (`nodes`, `edges`). |
| `POST` | `/v1/workspaces/{id}/catalog/enable` | Admin+ | `{ "enabled": true \| false }`. |
| `POST` | `/v1/workspaces/{id}/catalog/seed` | Admin+ | Idempotent connector seed. |
| `PUT` | `/v1/workspaces/{id}/catalog/files` | Member+ | `{ "path", "content" }` — upsert markdown file. |
| `DELETE` | `/v1/workspaces/{id}/catalog/files?path=` | Member+ | Remove a file. |

## Workspace Knowledge

Opt-in learned library. **Paid plan** required for `enable` and `backfill`. See [Workspace Knowledge](/teams/knowledge/).

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/knowledge` | Member+ | Settings + counts. |
| `GET` | `/v1/workspaces/{id}/knowledge/status` | Member+ | Training progress (24h window). |
| `GET` | `/v1/workspaces/{id}/knowledge/tree` | Member+ | Note summaries by kind. |
| `GET` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | One note (full body). |
| `PUT` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | Upsert note markdown. |
| `DELETE` | `/v1/workspaces/{id}/knowledge/files/{path}?forget=1` | Admin+ | Delete; `forget=1` stops re-learn. |
| `POST` | `/v1/workspaces/{id}/knowledge/enable` | Admin+ | `{ "enabled": true }` — paid plan. |
| `POST` | `/v1/workspaces/{id}/knowledge/backfill` | Admin+ | Queue up to 200 pages → `{ queued, kicked }` — paid plan. |

## Schedules and automations

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/schedules` | List schedules. Admin+. |
| `GET` | `/v1/workspaces/{id}/schedules/{jobId}/logs` | Recent logs. Admin+. |
| `POST` | `/v1/workspaces/{id}/schedules/{jobId}/run` | Run now. Admin+. |
| `PATCH` | `/v1/workspaces/{id}/schedules/{jobId}` | Enable/disable. Admin+. |
| `DELETE` | `/v1/workspaces/{id}/schedules/{jobId}` | Delete. Admin+. |
| `GET` | `/v1/workspaces/{id}/automations` | List automations. Admin+. |
| `GET` | `/v1/workspaces/{id}/automations/{triggerId}/runs` | Run history. Admin+. |
| `POST` | `/v1/workspaces/{id}/automations/{triggerId}/run` | Dispatch now. Admin+. |
| `PATCH` | `/v1/workspaces/{id}/automations/{triggerId}` | Enable/disable. Admin+. |
| `DELETE` | `/v1/workspaces/{id}/automations/{triggerId}` | Delete. Admin+. |
| `GET` | `/v1/workspaces/{id}/runs` | Unified run list (`surface`, `status`, `limit`). Admin+. |
| `GET` | `/v1/workspaces/{id}/runs/{surface}/{runId}` | Run Inspector detail (`crew`/`job`/`alert`). Admin+. |

## Workspace admin artifacts

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/admin/artifacts` | Admin+ | Governance table (views, owner, visibility…). |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/pause` | Admin+ | `{ "paused": true }`. |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/visibility` | Admin+ | Change visibility. |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/transfer` | Admin+ | Reassign owner `{ "new_owner_id" }`. |

## Access requests

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `POST` | `/v1/access-requests` | Public | Request access to a gated page. |
| `GET` | `/v1/access-requests/incoming` | Owner/admin | Pending requests for your workspaces. |
| `POST` | `/v1/access-requests/{id}` | Owner/admin | `{ "action": "approve" \| "deny" }`. |

## Support tickets

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `POST` | `/v1/support/tickets` | Signed-in | Create ticket `{ "subject", "body", "workspaceId"? }`. |
| `GET` | `/v1/support/tickets?scope=mine` | Signed-in | Requester's own tickets (default). |
| `GET` | `/v1/support/tickets?scope=workspace&workspace={id}` | Admin+ | Workspace tickets; optional `&status=`. |
| `GET` | `/v1/support/tickets?scope=all` | Super-admin | All platform tickets. |
| `GET` | `/v1/support/tickets/{id}` | Requester or staff | Ticket + full thread. |
| `POST` | `/v1/support/tickets/{id}/message` | Requester or staff | Append `{ "body" }` (customer reply re-opens). |
| `POST` | `/v1/support/tickets/{id}/reply` | Staff | Approve & send `{ "body" }` on origin channel. |
| `POST` | `/v1/support/tickets/{id}/status` | Staff | `{ "status": "resolved" }` etc. |
| `POST` | `/v1/support/tickets/{id}/assign` | Staff | `{ "assigneeUserId": "usr_…" }` or `null`. |
| `POST` | `/v1/support/tickets/{id}/triage` | Staff | Re-run AI triage draft. |

See [Get help](/everyone/get-help/) and [Admin → Support](/teams/admin/#support-tickets).

## Metric alerts (Teams permissions)

Endpoints stay under `/v1/metric-alerts`. Teams changes who can manage:

| Role | Capability |
| --- | --- |
| Artifact `owner`/`editor` or workspace `owner`/`admin` | Full alert management on the artifact. |
| Workspace `member` or artifact `viewer` | Self-subscribe to personal destinations only. |

See [Metric alerts](/guides/metric-alerts/).

## Metric watches

One-click anomaly watches on artifact tables — bell-only, no destinations.
See [Metric alerts → Watches](/guides/metric-alerts/#metric-watches).

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `POST` | `/v1/metric-watch` | Viewer+ on artifact | `{ "artifact_id", "table", "kind", "column?", "threshold_pct?" }` |
| `GET` | `/v1/metric-watch?artifact_id=` | Viewer+ | List watches on a page |
| `DELETE` | `/v1/metric-watch/{id}` | Creator | Remove a watch |

## Features

```http
GET /v1/workspaces/{id}/features
```

Returns enabled/disabled flags. `readonly: true` — only ShareOut super-admins
can toggle workspace features.

## Session policy

```http
GET /v1/workspaces/{id}/session-policy
PUT /v1/workspaces/{id}/session-policy        ← { "session_max_days": 7 }
```

`session_max_days` is `1`–`30` or `null` (inherit the 30-day default). `GET`
requires membership; `PUT` requires `admin`/`owner` and the Teams plan
(`402 TIER_REQUIRED` otherwise). See [Admin](/teams/admin/#session-length-policy).

## Publish policy

```http
GET   /v1/workspaces/{id}/publish-policy
PATCH /v1/workspaces/{id}/publish-policy        ← { "policy": "require_approval", "approvals_required": 2 }
GET   /v1/workspaces/{id}/publish-approvals?status=pending
POST  /v1/artifacts/{id}/publish-approval       ← { "visibility": "public", "approver_ids": ["usr_a"] }
POST  /v1/artifacts/{id}/publish-approval/{requestId}/decision  ← { "decision": "approve" }
```

`PATCH` requires `admin`/`owner`. See [Publishing policy](/teams/admin/#publishing-policy)
and [Publishing artifacts](/guides/publishing/#workspace-publish-governance).

## Device login

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `POST` | `/v1/auth/device/start` | Public | Start CLI login. Optional `{ "expected_email" }` → `login_hint` + mismatch `warn`. |
| `POST` | `/v1/auth/device/token` | Public | Poll with `{ "device_code" }`. Pending / approved / expired. Token once. |

Browser step: `GET /auth/device?code=USER-CODE` → Google OAuth. See
[Authentication → Device login](/start/authentication/#device-login-cli--agents).

## Search

Ranked, typo-tolerant search — the same engine behind the Home **⌘K** palette and
inline quick-jump. Finds **pages** (name, tags, description), plus **folders**,
**datasets**, **connectors**, **people**, **schedules**, **crew**, and **alerts**
when scoped to a workspace.

```http
GET /v1/search?q={query}&groups={csv}&limit={n}&workspace={id}
Authorization: Bearer {token}
```

| Param | Default | Notes |
| --- | --- | --- |
| `q` | *(required)* | Search text. Typo-tolerant. Empty returns recents. |
| `groups` | all | Comma subset of `artifacts,folders,datasets,connectors,people,schedules,crew,alerts`. |
| `limit` | 10 | Max per group (cap 25). |
| `workspace` | — | Scope (personal tokens only; `sot_` tokens are pinned to their workspace). |

Auth: personal `so_…` token, workspace Agent `sot_…` token (`artifacts:read`), or
session cookie. Non-artifact groups require a workspace scope.

Response groups (`artifacts`, `folders`, `datasets`, `connectors`, `people`,
`schedules`, `crew`, `alerts`) each carry scored hits. Artifact hits include
`views`, `owner`, `thumb`, and `badge` (e.g. `Private`).

Inside the workspace assistant chat, the same search is exposed as
**`search_workspace`** — prefer it over `search_artifacts` for anything but an
exact page name.

## Ask your workspace (palette)

Single-turn Q&A over pages the caller can access — read-only, no tools.

```http
POST /v1/ask
Authorization: Bearer {token}
Content-Type: application/json

{ "question": "What was Q3 revenue?", "workspace": "wsp_…" }
```

Response: `{ "answer": "…", "citations": [{ "artifact_id", "title", "url" }] }`.
Citations are pages the model referenced with `[n]` markers from the scoped
candidate set. Also triggered from Home ⌘K when the query ends with `?`.

## Export

One-click data portability — zip of source + json + tables.

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/artifacts/{id}/export` | Owner or workspace admin | Single artifact zip |
| `GET` | `/v1/workspaces/{id}/export` | Workspace owner/admin | All artifacts (max **200**) |

See [Your data is portable](/guides/data-portability/).

## Present this

AI-generate a slides deck from a published HTML artifact.

```http
POST /v1/artifacts/{id}/present
Authorization: Bearer {token}
```

Returns `{ "artifact_id", "url" }`. Rate-limited per user. See [Slides overview → Present this](/slides/overview/#present-this-ai-deck).

## Unused pages (janitor)

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `POST` | `/v1/workspaces/{id}/unused/archive` | Workspace owner/admin | Archive all flagged unused pages (batch 100) |
| `POST` | `/v1/artifacts/unused/archive` | Personal account owner | Same for personal pages |

See [Publishing → Unused-page janitor](/guides/publishing/#unused-page-janitor).

## Skill Marketplace

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/skills/recommended` | Signed-in | Official **Recommended by ShareOut** strip (all plans). |
| `GET` | `/v1/skills/{skillId}/markdown` | Signed-in | Raw `SKILL.md` for the in-Studio viewer (official or visible skill). |
| `GET` | `/v1/workspaces/{scope}/agent-skills` | Member+ | Skills attached to **my** agent (`scope` = workspace id or `__personal`). |
| `POST` | `/v1/workspaces/{scope}/agent-skills` | Member+ | Attach to my agent (`skill_artifact_id`). Max 8. |
| `DELETE` | `/v1/workspaces/{scope}/agent-skills/{skillId}` | Member+ | Detach from my agent. |
| `GET` | `/v1/workspaces/{id}/skills` | Member+ | Browse catalog (`sort`, `category`, `q`). Teams plan. |
| `GET` | `/v1/workspaces/{id}/skills/categories` | Member+ | Category counts. |
| `GET` | `/v1/workspaces/{id}/skills/installed` | Member+ | Saved skills. |
| `POST`/`DELETE` | `/v1/artifacts/{id}/skill/vote` | Member+ | Upvote / remove vote. |
| `POST`/`DELETE` | `/v1/artifacts/{id}/skill/install` | Member+ | Save / unsave to My Skills. |
| `PATCH` | `/v1/artifacts/{id}/skill/admin` | Admin+ | `{ "featured" }` or `{ "blocked" }`. |
| `GET` | `/v1/artifacts/{id}/skills` | Viewer+ | List attached skills. |
| `POST` | `/v1/artifacts/{id}/skills` | Editor+ | Attach skill (`skill_artifact_id`). Max 5. |
| `POST`/`DELETE` | `/v1/artifacts/{id}/skills/{skillId}` | Editor+ | Bump version / detach. |

Publish skills with `artifact_type: "skill"` on `POST /v1/publish`. See
[Skill Marketplace](/teams/skill-marketplace/).

## Workspace LLM & AI credit

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/llm` | Member+ | Provider config summary and BYO key status. No secrets. |
| `PUT` | `/v1/workspaces/{id}/llm` | Admin+ | Save BYO OpenAI / Vercel AI Gateway key. |
| `DELETE` | `/v1/workspaces/{id}/llm` | Admin+ | Remove BYO key. |

AI calls run on the key this workspace supplies, billed by that provider directly.

## Audit log

```http
GET /v1/workspaces/{id}/audit?limit=100
```

Admin/owner only. Returns the append-only governance trail (`entries[]` with
`ts`, `actor_email`, `action`, `target_type`, `target_id`, `detail`). One-year
retention. See [Admin](/teams/admin/#audit-log).

## Home activity

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/home/activity-feed?workspace=&window=&limit=` | Member+ | Needs You + Pulse (`window`: `today`, `7d`, `30d`). Returns `needs`, `seen` (dismissed/opened needs still in window), `pulse`, `actionItems`, `requestedOpen`. |
| `POST` | `/v1/home/dismiss-event` | Member+ | Hide Needs You events for the signed-in user (`{ "eventId" }` or `{ "eventIds": [] }`). Used by the notifications panel (dismiss, mark-all-read, or opening a card). |
| `GET` | `/v1/home/agent/brief?workspace=` | Member+ | Proactive daily AI brief (when `ai.web_agent` on). |
| `POST` | `/v1/home/agent/chat` | Member+ | Home-scoped assistant chat (SSE). |
| `POST` | `/v1/home/agent/confirm` | Member+ | Confirm pending assistant action. |
| `GET` | `/v1/home/agent/threads` | Member+ | List named chat threads. |
| `POST` | `/v1/home/agent/threads` | Member+ | Create thread. |
| `POST` | `/v1/home/agent/threads/{id}/rename` | Member+ | Rename thread. |
| `DELETE` | `/v1/home/agent/threads/{id}` | Member+ | Delete thread. |
| `POST` | `/v1/workspace/{id}/agent/chat` | Member+ | Workspace-scoped assistant chat (SSE). |
| `GET` | `/v1/home/event-visibility?workspace=` | Member+ | Per-kind audience map; `canManage` for admins. |
| `PUT` | `/v1/home/event-visibility?workspace=` | Admin+ | `{ "kind", "audience" }` — see [Activity visibility](/teams/admin/#activity-visibility). |
| `GET` | `/v1/home/onboarding?workspace=` | Member+ | Setup checklist status (`track`, `tasks`, `pct`, `dismissed`) or `{ track: null }`. |
| `POST` | `/v1/home/onboarding/dismiss?workspace=` | Member+ | Hide the checklist for this user. |
| `POST` | `/v1/home/onboarding/skill-ack?workspace=` | Member+ | Acknowledge the "Get the skill" task. |
| `POST` | `/v1/home/onboarding/celebrate?workspace=` | Member+ | Record the one-shot 100% moment. |
| `GET` | `/v1/artifacts/{id}/presence` | Owner/collaborator+ | Live concurrent viewer count (best-effort). |

## Artifact delivery (one-shot)

Send an artifact to email, Slack, or Telegram immediately from Home Inspector
**Deliver** or the API — same destination registry as scheduled jobs.

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/artifacts/{id}/deliver` | Collaborator+ | Per-channel status (`telegram.linked`, `slack.connected` + `connectUrl`, `email.available`). |
| `GET` | `/v1/artifacts/{id}/deliver/slack-channels` | Collaborator+ | Searchable channel list for the workspace Slack connection. |
| `POST` | `/v1/artifacts/{id}/deliver` | Collaborator+ | `{ "action": "email" \| "slack" \| "telegram", "config": {…} }` — same `config` shape as [jobs](/guides/jobs/). Viewers may only deliver to themselves on Slack/Telegram. |

See [Your workspace → Inspector](/everyone/your-workspace/#inspector-right-rail),
[Slack delivery](/integrations/slack/), and [Your workspace (Home)](/everyone/your-workspace/).
