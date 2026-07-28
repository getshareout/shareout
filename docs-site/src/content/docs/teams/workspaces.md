---
title: Workspaces
description: Create and manage Teams workspaces — members, roles, visibility, and membership policy.
---

import { Aside } from '@astrojs/starlight/components';

A workspace is a shared container for artifacts, members, folders, and
connectors. Each workspace has its own role hierarchy, membership policy,
and optional subdomain.

## Create a workspace

```http
POST /v1/workspaces
Authorization: Bearer {token}
Content-Type: application/json

{ "name": "Acme Analytics", "slug": "acme" }
```

## Get a workspace

```http
GET /v1/workspaces/{workspaceId}
GET /v1/workspaces/by-slug/{slug}
```

## Update or delete

```http
PATCH /v1/workspaces/{workspaceId}
DELETE /v1/workspaces/{workspaceId}
```

Delete requires `owner` role and cascades to memberships.

## Members and roles

| Role | Capabilities |
| --- | --- |
| `owner` | Full workspace control, including delete and ownership transfer. Can edit **any** workspace artifact in Live Studio and Edit-Lite. |
| `admin` | Manage members, policy, subdomain, connectors, schedules, automations. Can edit **any** workspace artifact in Live Studio and Edit-Lite. |
| `member` | Create/edit own artifacts; view workspace-visible artifacts. Editing another member's artifact requires an explicit **editor** collaborator invite. |

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/members` | List members. |
| `POST` | `/v1/workspaces/{id}/members` | Add a member; policy-gated. |
| `DELETE` | `/v1/workspaces/{id}/members/{userId}` | Remove a member. |
| `POST` | `/v1/workspaces/{id}/members/invite` | Bulk invite by email. |
| `GET` | `/v1/workspaces/{id}/members/metrics` | Member activity metrics. Admin+. |
| `GET` | `/v1/workspaces/{id}/people` | People picker list for UI. |
| `POST` | `/v1/workspaces/{id}/transfer-ownership` | Transfer to another member. Owner only. |

Re-inviting an existing member with `POST /members` updates their role (`member` or
`admin`). Owners cannot be demoted via this path.

## Workspace logo

Upload a logo from **Admin → Branding** in Home or via API:

```http
POST /v1/workspaces/{workspaceId}/logo
Content-Type: multipart/form-data

DELETE /v1/workspaces/{workspaceId}/logo
```

Served at `/wl/{workspaceId}.{ext}` for the Home rail and subdomain branding.
Admin+ only.

## Membership policy

Controls who may join — separate from per-artifact `access_policy`.

```http
GET /v1/workspaces/{workspaceId}/access-policy
Authorization: Bearer {token}
```

```json
{
  "allowed_domains": ["example.com"],
  "allowed_emails": ["contractor@example.net"]
}
```

Set policy (`admin` or `owner`):

```http
PUT /v1/workspaces/{workspaceId}/access-policy
Authorization: Bearer {token}
Content-Type: application/json

{
  "allowed_domains": ["example.com"],
  "allowed_emails": ["contractor@example.net"]
}
```

Rules:

- `allowed_domains` — users with matching email domains join automatically as `member` on login.
- `allowed_emails` — individual allowlist for emails outside the allowed domains.
- Send `[]` to clear a list. Omit a field to leave it unchanged.
- Inviting outside policy: `403 DOMAIN_NOT_ALLOWED`.

## Workspace visibility

Publish an artifact with `visibility: "workspace"` so every workspace member
can see it:

```json
{
  "workspace_id": "wsp_abc123",
  "visibility": "workspace"
}
```

`workspace` visibility requires `workspace_id` to be set.

## Workspace context files

Optional markdown files that teach agents your team's house style. Members
read them; admins manage them.

```http
GET /v1/workspaces/{workspaceId}/context
GET /v1/workspaces/{workspaceId}/context/{name}
PUT /v1/workspaces/{workspaceId}/context/{name}
DELETE /v1/workspaces/{workspaceId}/context/{name}
PUT /v1/workspaces/{workspaceId}/context          ← set entry file: { "entry": "index.md" }
```

Writes require `admin` or `owner`. Files must be lowercase `.md`, ≤ 64 KB.

Recommended files:

| File | Contents |
| --- | --- |
| `index.md` | Short entry point, golden rules, links to topic files. |
| `style.md` | Colors, fonts, layout, logo, chart conventions. |
| `voice.md` | Tone, terminology, words to use/avoid. |
| `conventions.md` | Report and dashboard structure. |
| `data.md` | Connector names, metric definitions, key tables. |

Agents can fetch the workspace-scoped skill (context included) via:

```http
GET /v1/skill?workspace={workspaceSlugOrId}
Authorization: Bearer {token}
```

## Branding

Upload a workspace logo and set brand colors:

```http
POST /v1/workspaces/{workspaceId}/logo
PUT /v1/workspaces/{workspaceId}/branding
GET /v1/workspaces/{workspaceId}/branding
DELETE /v1/workspaces/{workspaceId}/logo
```

<Aside type="tip">
See [Subdomains](/teams/subdomain/) to serve workspace artifacts at
`{workspace}.shareout.site`.
</Aside>

## Personal vs workspace model

Artifacts without a `workspace_id` belong to the **Personal** space (the
publishing owner). Setting `workspace_id` at publish time moves the artifact
into a workspace — it appears in the Team Space alongside folders and
workspace-visible content.

On the home screen, use the **avatar switcher** to move between Personal and each
team workspace you belong to. Personal and Team Space each have their own folder
chips in one unified top bar.

The redesigned [workspace Home](/everyone/your-workspace/) adds tabbed artifacts,
the Inspector (Details, Comments, Automate), quick Edit mode, and the Activity feed
(Needs You + Pulse).
