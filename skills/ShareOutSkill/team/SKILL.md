---
name: "shareout-workspace-skill"
version: "3.30.0"
updated_at: "2026-07-25T20:00:00Z"
description: "Workspace administration overlay for ShareOut. Load after the base skill when the user asks to manage workspace members and roles, internal workspace visibility, subdomains, membership policy, publish governance, workspace connectors, the Home assistant, activity feed, admin portal and Run Inspector, skill marketplace, support workbench, file inbox, Workspace Knowledge, or external sharing with clients. On self-host / OSS there are no paid plan gates — use workspace roles, not Pro/Teams language."
skill_endpoint: "/v1/skill/team/SKILL.md"
extends: "shareout-skill"
---

# ShareOut Workspace Skill

Workspace administration on top of the base artifact system. Always load
[../SKILL.md](../SKILL.md) first.

Every workspace capability below is available once the instance is up and the caller
has the right **workspace role** (`owner` / `admin` / `member`). There are no plans in
this build: do **not** ask “are you on Teams?”, offer an upgrade, or invent a checkout.

## Loading protocol

1. Confirm the task is workspace admin / multi-user (members, subdomain, governance, …).
2. Resolve `$ORIGIN` from credentials (see base skill).
3. If workspace slug/id and token are available:

   ```http
   GET $ORIGIN/v1/skill?workspace={workspaceSlugOrId}
   Authorization: Bearer {token}
   ```

   Returns the base skill plus house-style `workspace-context.md` when present.
4. Load [INDEX.md](INDEX.md) for the workspace file router.
5. Before writes, confirm the caller has the required workspace role.

## No plan gates

Personal / Pro / Teams are not behavior switches. Decide from role and features:

| Check | How |
| --- | --- |
| Can they admin this workspace? | Role `owner` or `admin` on the workspace |
| Is a feature on? | `GET $ORIGIN/v1/workspaces/{id}/features` if unsure |
| Subdomain allowed? | `GET $ORIGIN/v1/workspaces/{id}/subdomain` → `can_manage` |

If something is locked that should be open, it is instance config or a feature flag —
never an upgrade.

## Workspace roles

| Role | Use |
| --- | --- |
| `owner` | Full workspace control. Can edit **any** workspace artifact in Live Studio and Edit-Lite. |
| `admin` | Manage members, membership policy, subdomain, workspace settings, schedules, automations. Can edit **any** workspace artifact in Live Studio and Edit-Lite. |
| `member` | Create/edit own artifacts and view workspace-visible artifacts. Needs explicit **editor** collaborator invite to edit others' pages. |

## Workspace visibility

| Visibility | Who can view |
| --- | --- |
| `private` | Owner plus explicit collaborators/share credentials. Default. |
| `workspace` | Every member of the artifact's workspace, still subject to row-level `access_policy`. |
| `public` | Anyone on the internet with the link; when open visibility is enabled. |

Use `visibility: "workspace"` only when `workspace_id` is set.

## Workspace membership policy

Who may join a workspace by email/domain — not the same as artifact row-level
`access_policy`.

```http
GET $ORIGIN/v1/workspaces/{workspaceId}/access-policy
Authorization: Bearer {token}
```

```http
PUT $ORIGIN/v1/workspaces/{workspaceId}/access-policy
Authorization: Bearer {token}
Content-Type: application/json

{
  "allowed_domains": ["example.com"],
  "allowed_emails": ["contractor@example.net"]
}
```

Rules:

- `allowed_domains` auto-joins matching users as `member` on login.
- `allowed_emails` permits individual invites outside those domains.
- Empty/unset lists mean no domain restriction.
- Writes require `admin` or `owner`.

## Subdomains

Workspaces can serve artifacts at `{workspace}.{your-apex}` when DNS is configured
(see [../deploy/cloudflare.md](../deploy/cloudflare.md)).

```http
POST $ORIGIN/v1/workspaces/{workspaceId}/subdomain
Authorization: Bearer {token}
Content-Type: application/json

{ "enabled": true }
```

Requirements:

- Workspace role: `admin` or `owner`.
- Check `GET …/subdomain` → `eligible` and `can_manage` before offering the control.
  See [subdomain.md](subdomain.md).

On self-host, if `eligible` is false, fix DNS/`SHAREOUT_BASE_URL` — do not suggest a paid plan.

## Workspace context files

Optional house rules for agents: style, voice, structure, data notes.

```http
GET $ORIGIN/v1/workspaces/{workspaceId}/context
GET $ORIGIN/v1/workspaces/{workspaceId}/context/{name}
PUT $ORIGIN/v1/workspaces/{workspaceId}/context/{name}
DELETE $ORIGIN/v1/workspaces/{workspaceId}/context/{name}
```

Bootstrap only when an admin/owner asks. Keep `index.md` short; details in `style.md`,
`voice.md`, `conventions.md`, `data.md`.

## Workspace connectors

Reusable team data sources. Artifacts reference connectors **by name**.

| Need | Pattern | Doc |
| --- | --- | --- |
| One token for the whole team | `credentialScope: "shared"` | [workspace-connections.md](workspace-connections.md) |
| Each member brings their own token | `credentialScope: "per_user"` | [workspace-connections.md](workspace-connections.md) |
| OAuth warehouse / SaaS | `kind: "platform"` | [../integrations/overview.md](../integrations/overview.md) |

Never embed tokens in published HTML.

## Workspace shared tables

One artifact owns a table and opts it into the workspace; others read/write with
`so.workspace.table(name)`. See [workspace-tables.md](workspace-tables.md).

## Workspace admin surfaces

| Task | Endpoint / reference |
| --- | --- |
| Members | `GET/POST /v1/workspaces/{id}/members` · [admin-portal.md](admin-portal.md) |
| Bulk invites | `POST /v1/workspaces/{id}/members/invite` |
| Pending invites | `GET/DELETE /v1/workspaces/{id}/invites` |
| Artifact governance | `GET /v1/workspaces/{id}/admin/artifacts` · [admin-portal.md](admin-portal.md) |
| Run Inspector | `GET /v1/workspaces/{id}/runs` · [admin-portal.md](admin-portal.md#run-inspector) |
| Workspace logo | `POST/DELETE /v1/workspaces/{id}/logo` |
| Session policy | `GET/PUT /v1/workspaces/{id}/session-policy` · [api.md](api.md#session-policy) |
| Audit log | `GET /v1/workspaces/{id}/audit` · [api.md](api.md#audit-log) |
| Features | `GET /v1/workspaces/{id}/features` |
| Schedules / automations | `GET /v1/workspaces/{id}/schedules` · `…/automations` |
| Connections | `GET/POST /v1/workspaces/{id}/connections` · [workspace-connections.md](workspace-connections.md) |
| Workspace assistant | Home chat · [workspace-assistant.md](workspace-assistant.md) |
| Admin portal | Ten-tab governance UI · [admin-portal.md](admin-portal.md) |
| Support tickets | [../api/support.md](../api/support.md) |
| Home lenses | [../core/workspace-home.md](../core/workspace-home.md#workspace-lenses) |
| Assets | [assets.md](assets.md) |
| Knowledge | [knowledge.md](knowledge.md) |
| Activity feed | [activity-feed.md](activity-feed.md) |
| Search | [../api/search.md](../api/search.md) |
| Publish governance | [publish-governance.md](publish-governance.md) |
| Skill marketplace | [skill-marketplace.md](skill-marketplace.md) |
| Data catalog | [catalog.md](catalog.md) |
| Shared tables | [workspace-tables.md](workspace-tables.md) |
| External sharing | [external-sharing.md](external-sharing.md) |
| Folders | [folders.md](folders.md) |

Metric alerts: base skill [../api/metric-alerts.md](../api/metric-alerts.md).


## References

- [INDEX.md](INDEX.md) — intent router  
- [api.md](api.md) — workspace REST details (skip billing section on self-host)  
- [admin-portal.md](admin-portal.md)  
- [subdomain.md](subdomain.md)  
- [workspace-context.md](workspace-context.md)  
- [workspace-connections.md](workspace-connections.md)  
- [workspace-tables.md](workspace-tables.md)  
- [folders.md](folders.md) · [assets.md](assets.md) · [knowledge.md](knowledge.md)  
- [external-sharing.md](external-sharing.md) · [publish-governance.md](publish-governance.md)  
- [skill-marketplace.md](skill-marketplace.md)  
- [../modules/_shared/permissions.md](../modules/_shared/permissions.md)  
- [../core/access-policy.md](../core/access-policy.md)  
