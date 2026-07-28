# Workspace API Reference

REST endpoints for ShareOut **workspace** capabilities. Load [SKILL.md](SKILL.md) first.
Prefix every path with `$ORIGIN` (see base skill).

There is no checkout and no plan API. Gate on **workspace role**
(`owner` / `admin` / `member`) and `GET $ORIGIN/v1/workspaces/{id}/features`.

## Authentication

All write/admin endpoints require:

```http
Authorization: Bearer {token}
```

Some workspace reads also accept a logged-in browser session.

## Features

```http
GET $ORIGIN/v1/workspaces/{id}/features
Authorization: Bearer {token}
```

If a needed feature is off, fix instance config or the feature flag — there is no
paid upgrade to sell.

## Members And Roles

Workspace roles:

| Role | Capability |
| --- | --- |
| `owner` | Full workspace control. |
| `admin` | Manage members, policy, subdomain, settings, workspace admin tasks. |
| `member` | Create/edit own artifacts; view workspace-visible artifacts. |

Endpoints:

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/members` | List members. |
| `POST` | `/v1/workspaces/{id}/members` | Add member; policy-gated. Re-posting an existing member updates their role (`member` or `admin`). |
| `DELETE` | `/v1/workspaces/{id}/members/{userId}` | Remove member. Also drops their Client (Sharee) links and `external_user` grants in this workspace — the membership edge alone does not gate grant access. |
| `POST` | `/v1/workspaces/{id}/members/invite` | Invite one or more members. |
| `GET` | `/v1/workspaces/{id}/members/metrics` | Member activity metrics. |
| `GET` | `/v1/workspaces/{id}/people` | Workspace people picker/list. |
| `POST` | `/v1/workspaces/{id}/logo` | Upload workspace logo (image). Admin+. |
| `DELETE` | `/v1/workspaces/{id}/logo` | Remove workspace logo. Admin+. |

Seat usage: `GET /v1/workspaces/{id}` may include `seats: { used, limit, remaining }`.
On self-host, `limit` is typically unlimited / unset — do not invent seat paywalls.

## Workspace Membership Policy

This controls who may join a workspace. It is not row-level artifact `access_policy`.

```http
GET /v1/workspaces/{workspaceId}/access-policy
Authorization: Bearer {token}
```

```json
{
  "allowed_domains": ["example.com"],
  "allowed_emails": ["audit@partner.com"]
}
```

Set policy:

```http
PUT /v1/workspaces/{workspaceId}/access-policy
Authorization: Bearer {token}
Content-Type: application/json

{
  "allowed_domains": ["example.com"],
  "allowed_emails": ["audit@partner.com"]
}
```

Rules:

- `GET` requires workspace membership.
- `PUT`/`PATCH` requires `admin` or `owner`.
- Omit a field to leave it unchanged.
- Send `[]` to clear a list.
- Invalid domains return `400 INVALID_DOMAIN`.
- Invalid emails return `400 INVALID_EMAIL`.
- Inviting an email outside policy returns `403 DOMAIN_NOT_ALLOWED`.

## Subdomain

```http
GET /v1/workspaces/{workspaceId}/subdomain
POST /v1/workspaces/{workspaceId}/subdomain
DELETE /v1/workspaces/{workspaceId}/subdomain
```

Enable:

```http
POST /v1/workspaces/{workspaceId}/subdomain
Authorization: Bearer {token}
Content-Type: application/json

{ "enabled": true }
```

Requirements:

- Workspace role: `admin` or `owner`.
- Prefer `GET …/subdomain` → `eligible` / `can_manage` before enabling.
- On self-host, if not eligible, fix DNS / `SHAREOUT_BASE_URL` — do **not** offer a paid plan.
- If the API returns `402 TIER_REQUIRED` on self-host, treat as misconfiguration / bug.

## Session Policy

Per-workspace session lifetime.

```http
GET /v1/workspaces/{workspaceId}/session-policy
PUT /v1/workspaces/{workspaceId}/session-policy
```

```http
PUT /v1/workspaces/{workspaceId}/session-policy
Authorization: Bearer {token}
Content-Type: application/json

{ "session_max_days": 7 }
```

- `session_max_days`: integer `1`–`30`, or `null` to inherit the 30-day default.
- `GET` returns `{ session_max_days, platform_default_days: 30, eligible }`; requires membership.
- `PUT` requires `admin`/`owner`. On self-host, ignore plan/tier upgrade URLs if returned.
- A session is per-user and spans every subdomain, so login applies the **strictest** policy across the user's workspaces; you can only tighten below 30 days, never extend.

## Audit Log

Append-only governance trail. Admin/owner read only.

```http
GET /v1/workspaces/{workspaceId}/audit?limit=100
Authorization: Bearer {token}
```

```json
{
  "entries": [
    { "ts": "...", "actor_email": "admin@acme.co", "action": "member.remove",
      "target_type": "user", "target_id": "usr_123", "detail": { "removed_role": "member" } }
  ]
}
```

Records member add/remove, bulk invite, ownership transfer, subdomain enable/disable, membership-policy changes, connection create/delete, and session-policy changes. Retained one year.

## Workspace Context

```http
GET    /v1/workspaces/{workspaceId}/context
PUT    /v1/workspaces/{workspaceId}/context
GET    /v1/workspaces/{workspaceId}/context/{name}
PUT    /v1/workspaces/{workspaceId}/context/{name}
DELETE /v1/workspaces/{workspaceId}/context/{name}
```

See [workspace-context.md](workspace-context.md).

## Workspace Connections

Full guide: [workspace-connections.md](workspace-connections.md) (shared vs **per-user** credentials, GraphQL, agent checklist).

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/connections` | Member+ | List connectors. Includes `credentialScope`, `hasMyCredentials` (per-user). No secrets. |
| `POST` | `/v1/workspaces/{id}/connections` | Admin+ | Create connector. `credentialScope`: `shared` (default) or `per_user`. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Detail + non-secret credential summary. |
| `DELETE` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Delete connector (cascades member credentials). |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}/artifacts` | Member+ | Artifacts that have queried this connector. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Per-user only: `{ configured, authType, updatedAt }`. |
| `PUT` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Save/update **your** token for a `per_user` connector. |
| `DELETE` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Remove **your** saved token. |
| `POST` | `/v1/workspaces/{id}/connections/test` | Admin+ | Verify pasted credentials before saving. |
| `PATCH` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Toggle `agent_query_enabled` for workspace assistant. |
| `POST` | `/v1/home/agent/chat` | Member+ | Home agent chat (SSE). Body `{ text, threadId? }`. Requires `ai.web_agent`. |
| `POST` | `/v1/home/agent/transcribe?seconds=` | Member+ | Transcribe mic audio (raw body). Returns `{ text }`. Requires `ai.web_agent`. |
| `POST` | `/v1/home/agent/confirm` | Member+ | Confirm a pending Home agent action (JSON or SSE for builds). |
| `GET` | `/v1/home/agent/threads` | Member+ | List named chat threads. |
| `GET` | `/v1/home/agent/threads/{id}` | Member+ | Thread messages (`?before=` for pagination). |
| `POST` | `/v1/home/agent/threads/{id}/rename` | Member+ | `{ "title": "…" }`. |
| `DELETE` | `/v1/home/agent/threads/{id}` | Member+ | Delete a thread. |
| `GET` | `/v1/home/agent/media/{token}` | Member+ | Fetch assistant-attached media. |
| `POST` | `/v1/workspace/{id}/agent/chat` | Member+ | Workspace-scoped assistant chat (SSE, same as Home without canvas tools). |
| `POST` | `/v1/workspace/{id}/agent/confirm` | Member+ | Confirm a pending assistant action. |
| `GET` | `/v1/workspace/{id}/agent/threads` | Member+ | List threads (workspace scope). |
| `GET` | `/v1/workspace/{id}/agent/threads/{id}` | Member+ | Thread messages. |
| `POST` | `/v1/workspace/{id}/agent/threads/{id}/rename` | Member+ | Rename thread. |
| `DELETE` | `/v1/workspace/{id}/agent/threads/{id}` | Member+ | Delete thread. |
| `GET` | `/v1/workspace/{id}/agent/media/{token}` | Member+ | Fetch assistant-attached media. |
| `GET` | `/v1/workspaces/{id}/connections/{provider}/auth-url` | Admin+ | OAuth start URL. |
| `GET` | `/v1/workspaces/{id}/connections/{provider}/callback` | — | OAuth callback. |
| `GET` | `/v1/workspaces/{id}/connections/{connection}/slack/channels` | Member+ | Slack channel list. |
| `GET` | `/v1/oauth/slack/callback` | — | Slack OAuth callback. |

### Create shared generic connector

```json
POST /v1/workspaces/{id}/connections
{
  "name": "team_api",
  "type": "rest_api",
  "credentialScope": "shared",
  "config": { "baseUrl": "https://api.example.com" },
  "credentials": { "type": "api_key", "data": { "apiKey": "…" } }
}
```

### Create per-user connector (GraphQL, personal API keys)

Admin defines endpoint; **do not** send `credentials.data`:

```json
POST /v1/workspaces/{id}/connections
{
  "name": "acme_graphql",
  "type": "rest_api",
  "credentialScope": "per_user",
  "authType": "api_key",
  "config": {
    "baseUrl": "https://api.example.com/graphql",
    "apiKeyHeader": "Authorization",
    "apiKeyPrefix": "Bearer "
  }
}
```

Each member saves their token:

```json
PUT /v1/workspaces/{id}/connections/{connectionId}/my-credentials
{
  "credentials": { "type": "api_key", "data": { "apiKey": "member-token" } }
}
```

Artifacts query with `sdk.connection('acme_graphql')` — see [../sdk/live-data.md](../sdk/live-data.md).

**Errors:** `403 CREDENTIALS_REQUIRED` when a member queries before saving `my-credentials`. `400 NOT_PER_USER` when calling `my-credentials` on a shared connector.

## Workspace Schedules And Automations

Workspace admins can manage jobs/crew triggers across artifacts:

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/schedules` | List all workspace schedules. |
| `GET` | `/v1/workspaces/{id}/schedules/{jobId}/logs` | Recent schedule logs. |
| `POST` | `/v1/workspaces/{id}/schedules/{jobId}/run` | Run now. |
| `PATCH` | `/v1/workspaces/{id}/schedules/{jobId}` | Enable/disable. |
| `DELETE` | `/v1/workspaces/{id}/schedules/{jobId}` | Delete schedule. |
| `GET` | `/v1/workspaces/{id}/automations` | List crew triggers. |
| `GET` | `/v1/workspaces/{id}/automations/{triggerId}/runs` | Run history. |
| `POST` | `/v1/workspaces/{id}/automations/{triggerId}/run` | Dispatch now. |
| `PATCH` | `/v1/workspaces/{id}/automations/{triggerId}` | Enable/disable. |
| `DELETE` | `/v1/workspaces/{id}/automations/{triggerId}` | Delete trigger. |

Job payloads are documented in [../api/jobs.md](../api/jobs.md).

## Run Inspector

Unified run detail across crew, scheduled job, and metric-alert surfaces. Admin+ only. Full guide: [admin-portal.md](admin-portal.md#run-inspector).

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/runs?surface=&status=&limit=` | List recent runs (`surface`: `crew` \| `job` \| `alert`; `status`: `success` \| `failed`). |
| `GET` | `/v1/workspaces/{id}/runs/{surface}/{runId}` | Run detail — steps, tokens, cost, delivery, `rerunPath` when re-runnable. |

## Admin Artifact Governance

| Method | Endpoint | Who | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/admin/artifacts` | Admin+ | Governance table (owner, visibility, views, size, perf, paused). |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/pause` | Admin+ | `{ "paused": true \| false }`. |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/visibility` | Admin+ | `{ "visibility": "…" }`. |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/transfer` | Admin+ | `{ "email": "…" }` — reassign owner (must be workspace member). |

## Pending Invites

| Method | Endpoint | Who | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/invites` | Admin+ | List unclaimed invites. |
| `DELETE` | `/v1/workspaces/{id}/invites/{inviteId}` | Admin+ | Revoke pending invite. |
| `POST` | `/v1/workspaces/{id}/invites/{inviteId}/resend` | Admin+ | Resend invite email. |

## Workspace Shared Tables

Share one artifact's table with the workspace so other artifacts read/write it. Full guide: [workspace-tables.md](workspace-tables.md).

| Method | Endpoint | Who | Description |
| --- | --- | --- | --- |
| `POST` | `/v1/data/{artifactId}/workspace/_share` | Artifact owner | Share `{ table, as?, access: read\|readwrite }`. |
| `DELETE` | `/v1/data/{artifactId}/workspace/_share/{sharedName}` | Artifact owner | Stop sharing. |
| `GET` | `/v1/data/{artifactId}/workspace/_shares` | Any member artifact | Shares visible in the workspace. |
| `GET\|POST\|PATCH\|DELETE` | `/v1/data/{artifactId}/workspace/tables/{sharedName}/…` | Member artifact | Read (always) / write (only if `readwrite`) a shared table. |
| `GET` | `/v1/workspaces/{id}/shared-tables` | Any member | Workspace-wide shared-table catalog (Datasets tab). |

## Workspace Publish Governance

Gate when **members** take workspace artifacts to public visibility. Full guide: [publish-governance.md](publish-governance.md).

| Method | Endpoint | Who | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/publish-policy` | Any member | Current `policy` + `approvals_required`. |
| `PATCH` | `/v1/workspaces/{id}/publish-policy` | `admin`/`owner` | Set `allow`, `prohibit`, or `require_approval`. |
| `GET` | `/v1/workspaces/{id}/publish-approvals` | Any member | List approval requests (`?status=pending`); rows include `approvals_required`, `approved_count`, `artifact_slug`, `viewer_can_decide`. |
| `POST` | `/v1/artifacts/{id}/publish-approval` | Member requester | Nominate approvers; `visibility` + `approver_ids`. |
| `POST` | `/v1/artifacts/{id}/publish-approval/{requestId}/decision` | Nominated approver | `{ "decision": "approve" \| "reject" }`. |

Publish/PATCH responses may include `notice` and `approval_required: { required, artifact_id, visibility?, workspace_id? }` when the gate holds visibility at `workspace`. `PATCH /v1/artifacts/{id}` with open visibility returns **202** with the same `approval_required` shape.

## Skill Marketplace

Per-workspace catalog of `artifact_type: "skill"` markdown playbooks. Full guide: [skill-marketplace.md](skill-marketplace.md). On self-host, available when the instance exposes the marketplace (no paid plan required).

| Method | Endpoint | Who | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/skills/recommended` | Signed-in user | Official **Recommended by ShareOut** strip (workspace-agnostic). |
| `GET` | `/v1/workspaces/{id}/skills` | Member | Browse/rank (`?sort=top\|trending\|new`, `category`, `q`). |
| `GET` | `/v1/workspaces/{id}/skills/categories` | Member | Category list. |
| `GET` | `/v1/workspaces/{id}/skills/installed` | Member | Saved "My Skills" list. |
| `POST` | `/v1/artifacts/{skillId}/skill/vote` | Member | Upvote (idempotent). |
| `DELETE` | `/v1/artifacts/{skillId}/skill/vote` | Member | Remove vote. |
| `POST` | `/v1/artifacts/{skillId}/skill/install` | Member | Save to My Skills. |
| `DELETE` | `/v1/artifacts/{skillId}/skill/install` | Member | Unsave. |
| `GET` | `/v1/artifacts/{artifactId}/skills` | `editor`+ | List attached skills. |
| `POST` | `/v1/artifacts/{artifactId}/skills` | `editor`+ | Attach `{ skill_artifact_id, position }` (max 5). |
| `POST` | `/v1/artifacts/{artifactId}/skills/{skillId}` | `editor`+ | Bump attachment to latest skill version. |
| `DELETE` | `/v1/artifacts/{artifactId}/skills/{skillId}` | `editor`+ | Detach. |
| `PATCH` | `/v1/artifacts/{skillId}/skill/admin` | `admin`/`owner` | `{ featured }` or `{ blocked }`. |
| `GET` | `/v1/skills/{skillId}/markdown` | Signed-in | Raw `SKILL.md` for in-Studio viewer (official or visible skill). |
| `GET` | `/v1/workspaces/{scope}/agent-skills` | Member | Skills attached to caller's assistant (`scope` = workspace id or `__personal`). |
| `POST` | `/v1/workspaces/{scope}/agent-skills` | Member | Attach skill to caller's assistant (max 8). |
| `DELETE` | `/v1/workspaces/{scope}/agent-skills/{skillId}` | Member | Detach from caller's assistant. |

Publish a skill via `POST /v1/publish` with `artifact_type: "skill"` and `workspace_id`. Attach at publish with `attached_skill_ids` on non-skill artifacts.

## External Sharing

Share folders and artifacts **outside** the workspace with typed Client orgs (clients, suppliers, partners, investors). External members are free. Full guide: [external-sharing.md](external-sharing.md). On self-host, available when the instance enables external sharing — do not treat as a paid upsell.

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/sharees` | Admin+ | List Clients. |
| `POST` | `/v1/workspaces/{id}/sharees` | Admin+ | Create Client `{ name, type }`. |
| `GET/PATCH/DELETE` | `/v1/workspaces/{id}/sharees/{sid}` | Admin+ | Read/update/delete Client (branding, properties). |
| `GET/POST/DELETE` | `/v1/workspaces/{id}/sharees/{sid}/members[/{uid}]` | Admin+ | Invite/remove external members. |
| `GET/POST/DELETE` | `/v1/workspaces/{id}/grants[/{gid}]` | Admin+ | Folder/artifact/**file** grants (`view`/`comment`/`create`/`edit`). |
| `POST` | `/v1/workspaces/{id}/share-person` | Admin+ | Share one file/folder with one outside email — `{ email, resource_type, resource_id, capability }`. |
| `GET/POST/DELETE` | `/v1/workspaces/{id}/sharees/{sid}/members/{uid}/tokens[/{tid}]` | Admin+ | Scoped external `sot_` tokens (never `artifacts:publish`). |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}/activity` | Admin+ | Read receipts for one Client. |
| `GET` | `/v1/workspaces/{id}/sharee-activity` | Admin+ | Read receipts across all Clients. |
| `GET/PUT/DELETE` | `/v1/workspaces/{id}/sharees/{sid}/context[/{name}]` | Member read / admin write | Per-client private notes (AI memory). |

External members browse granted pages and files at **`GET /shared`** (branded portal). If create returns `403 EXTERNAL_SHARING_NOT_ENTITLED` on self-host, treat as feature/config — not a plan to buy.

## Workspace Library

Private, versioned JS modules imported like a CDN lib. Full guide: [libraries.md](libraries.md).

| Method | Endpoint | Who | Description |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/libraries` | Member | Workspace module catalog. |
| `GET` | `/v1/me/libraries` | Owner | Personal module catalog. |
| `POST` | `/v1/me/libraries` | Owner | Publish a module (session): `{ name, version, scope, workspace_id?, main, exports, js, readme }`. |
| `GET` | `/v1/artifacts/{id}/lib/{name}` | public | Resolve a module name → pinned-or-latest import URL for this artifact. |
| `GET` | `/v1/artifacts/{id}/libs` | `viewer`+ | List the artifact's version pins. |
| `POST` | `/v1/artifacts/{id}/libs` | `editor`+ | Pin `{ name, version? }` (defaults to latest). |
| `DELETE` | `/v1/artifacts/{id}/libs/{name}` | `editor`+ | Remove a pin. |

Publish via the token API with `POST /v1/publish`, `artifact_type: "library"`, `entrypoint: "README.md"`, and a `library: { version, main, exports }` block (omit `workspace_id` for a personal module). Versions are immutable — re-publishing a semver returns `409 LIBRARY_VERSION_EXISTS`. Modules serve at `/lib/<workspace-slug>/<name>@<semver>.js` (workspace) or `/lib/@u/<user-handle>/<name>@<semver>.js` (personal). Import with `await so.lib('<name>')`.

## Metric Alerts In Workspaces

Metric alert endpoints stay under `/v1/metric-alerts`; workspace role changes permissions.

| Role | Capability |
| --- | --- |
| Artifact owner/editor or workspace `owner`/`admin` | Define metrics, create alerts to any destination, manage every alert on the artifact. |
| Workspace `member` or viewer collaborator | Self-subscribe only to personal destinations. |

Full reference: [../api/metric-alerts.md](../api/metric-alerts.md).

## Home Activity

Activity feed and visibility settings for the redesigned workspace Home. Full guide: [activity-feed.md](activity-feed.md).

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/home/activity-feed?workspace=&window=&limit=` | Member+ | Needs You + Pulse (`window`: `today`, `7d`, `30d`). Returns `needs`, `seen` (dismissed/opened needs still in window), `pulse`, `actionItems`, `requestedOpen`. |
| `GET` | `/v1/home/agent/brief?workspace=` | Member+ | Proactive daily AI catch-up (`ai.web_agent` required). |
| `GET` | `/v1/home/event-visibility?workspace=` | Member+ | Per-kind audience config; `canManage` for admins. |
| `PUT` | `/v1/home/event-visibility?workspace=` | Admin+ | `{ "kind", "audience" }` — `self`, `members`, `admins`, or `off`. |
| `GET` | `/v1/home/onboarding?workspace=` | Member+ | Setup checklist status (`track`, `tasks`, `pct`, `eligible`, `dismissed`, `celebrated`) or `{ "track": null }` for externals / ineligible. |
| `POST` | `/v1/home/onboarding/dismiss` | Member+ | Hide the checklist for this user+workspace. |
| `POST` | `/v1/home/onboarding/skill-ack` | Member+ | Mark the "Get the skill" task done (not server-observable otherwise). |
| `POST` | `/v1/home/onboarding/celebrate` | Member+ | One-shot 100% celebration marker (client fires when showing the moment). |
| `POST` | `/v1/home/dismiss-event` | Member+ | Hide Needs You events for the signed-in user (`{ "eventId" }` or `{ "eventIds": [] }`). Used by the notifications panel (dismiss, mark-all-read, or opening a card). |
| `GET` | `/v1/artifacts/{id}/presence` | Owner/collaborator+ | Live concurrent viewer count (best-effort). |

## Search

Ranked, typo-tolerant workspace search — same engine as the Home **⌘K** palette and the workspace assistant's **`search_workspace`** tool. Full reference: [../api/search.md](../api/search.md).

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/search?q=&groups=&limit=&workspace=` | Token/session | Pages, folders, datasets, connectors, people, schedules, crew, alerts. `sot_` tokens auto-scope to their workspace. |

## Features

```http
GET /v1/workspaces/{workspaceId}/features
Authorization: Bearer {token}
```

Any member may view enabled/disabled workspace features. Workspace feature flags are read-only to normal users.

## Assets

Per-scope asset library: upload reusable files, group into versioned **deliverables**, bundle **collections**, and share WeTransfer-style download pages at `/d/<token>`. Personal scope uses `/v1/assets`; workspace scope uses `/v1/workspaces/{id}/assets` (any member). Full guide: [assets.md](assets.md).

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/assets` or `…/workspaces/{id}/assets` | Member | List deliverables, loose blobs, bucket usage. |
| `POST` | `…/assets/upload` → `PUT …/_upload/{token}` | Member | Two-step upload. |
| `POST` | `…/assets/deliverables` | Member | `{ blobId, name }` → versioned deliverable. |
| `POST` | `…/assets/deliverables/{id}/version` | Member | Add a new version. |
| `POST` | `…/assets/collections` | Member | Bundle deliverables. |
| `POST` | `…/assets/collections/{id}/share` | Member | `{ expiresAt?, gate?, password?, domains? }` → `/d/<token>`. |
| `POST` | `…/assets/collections/{id}/send` | Member | Email the link to a recipient. |
| `GET` | `…/assets/links` | Member | List sent links (gate, expiry, views, revoked). |
| `POST` | `…/assets/links/{linkId}/revoke` | Member | Revoke a link (page + bytes 404). |
| `GET` | `/v1/files/{deliverableId}/content` | Session/token | Latest file bytes; owner, member (workspace files), or sharee grant. |
| `POST` | `/v1/workspaces/{id}/share-person` | Admin+ | `{ email, resource_type: "file"\|"folder", resource_id, capability: "view"\|"comment" }`; `409` if internal member. |

**Gate values:** `none` (default), `password` (+ `password`), `domain` (+ `domains[]`). Gated bytes stream via `/d/<token>/file/<blobId>` after the viewer clears the gate. First open notifies the sender by email (deduped on 0→1 views).

SDK: [../sdk/files.md](../sdk/files.md) — `sdk.files.getUrl('dlv_…')`.

## Workspace Knowledge

Opt-in learned library. Full guide: [knowledge.md](knowledge.md). On self-host, `enable` / `backfill` follow admin role + feature flags — not a paid plan.

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/knowledge` | Member+ | Settings + counts. |
| `GET` | `/v1/workspaces/{id}/knowledge/status` | Member+ | Training progress (24h window). |
| `GET` | `/v1/workspaces/{id}/knowledge/tree` | Member+ | Note summaries by kind. |
| `GET` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | One note (full body). |
| `PUT` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | Upsert note markdown. |
| `DELETE` | `/v1/workspaces/{id}/knowledge/files/{path}?forget=1` | Admin+ | Delete; `forget=1` stops re-learn. |
| `POST` | `/v1/workspaces/{id}/knowledge/enable` | Admin+ | `{ "enabled": true }`. |
| `POST` | `/v1/workspaces/{id}/knowledge/backfill` | Admin+ | Queue up to 200 pages → `{ queued, kicked }`. |

## Artifact delivery (one-shot)

One-shot send from the Home Inspector **Deliver** section or API — email, Slack, or Telegram. Uses the same `config` shapes as [jobs](../api/jobs.md). Full UI flow: [../core/workspace-home.md](../core/workspace-home.md#inspector-right-rail).

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/v1/artifacts/{id}/deliver` | Collaborator+ | Per-channel status (`telegram.linked`, `slack.connected` + `connectUrl`, `email.available`). |
| `GET` | `/v1/artifacts/{id}/deliver/slack-channels` | Collaborator+ | Searchable channel list for the workspace Slack connection. |
| `POST` | `/v1/artifacts/{id}/deliver` | Collaborator+ | `{ "action": "email" \| "slack" \| "telegram", "config": {…} }`. Viewers may only deliver to themselves on Slack/Telegram. |

See also [../integrations/slack.md](../integrations/slack.md) and [../api/destinations.md](../api/destinations.md).

## Support tickets

Customer support tickets for the workspace. Full guide: [../api/support.md](../api/support.md) and [admin-portal.md](admin-portal.md#support-tickets).

| Method | Endpoint | Who | Notes |
| --- | --- | --- | --- |
| `POST` | `/v1/support/tickets` | Authenticated user | Open a ticket (`channel: skill` with Bearer token). |
| `GET` | `/v1/support/tickets?scope=mine` | Requester | Own tickets. |
| `GET` | `/v1/support/tickets?scope=workspace&workspace={id}` | Admin/owner | Workspace ticket list. |
| `GET` | `/v1/support/tickets/{id}` | Requester, workspace admin, super-admin | Ticket + thread. |
| `POST` | `/v1/support/tickets/{id}/message` | Requester | Add a follow-up (reopens if resolved). |
| `POST` | `/v1/support/tickets/{id}/reply` | Staff | Send reply on origin channel. |
| `POST` | `/v1/support/tickets/{id}/status` | Staff | e.g. `{ "status": "resolved" }`. |
| `POST` | `/v1/support/tickets/{id}/assign` | Staff | Assign to a workspace member. |
| `POST` | `/v1/support/tickets/{id}/triage` | Staff | Re-run AI triage draft. |
