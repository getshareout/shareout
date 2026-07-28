---
title: Teams overview
description: Workspaces, roles, subdomains, connectors, and admin tools.
---

import { Aside } from '@astrojs/starlight/components';

Workspaces build on the base ShareOut artifact system: everything personal
artifacts do still works, plus workspace membership, internal visibility, custom
subdomains, workspace-level data connectors, and admin tooling.

## No plans

This is the open-source tree. There are no tiers, no checkout, and no feature
flags tied to a subscription — workspace membership, internal visibility, custom
subdomains, connectors, and the admin tooling are all on. "Teams" below names a
set of capabilities, not something to buy.

Turn individual features off per workspace under **Admin → Features** if you want
a narrower surface.

## Seats

`GET /v1/workspaces/{id}` reports seat usage so admins can see workspace size:

```json
{
  "seats": { "used": 12, "limit": null, "remaining": null }
}
```

`limit` and `remaining` are always `null` — membership is unlimited.

## What Teams adds

| Capability | Where |
| --- | --- |
| Workspace membership & roles | [Workspaces](/teams/workspaces/) |
| `workspace` artifact visibility | [Workspaces](/teams/workspaces/) |
| Workspace membership policy (allowed domains/emails) | [Workspaces](/teams/workspaces/) |
| Team Space folders | [Folders](/teams/folders/) |
| Custom subdomain (`{workspace}.shareout.site`) | [Subdomains](/teams/subdomain/) |
| Shared & per-user workspace data connectors | [Connections](/teams/connections/) |
| Workspace home assistant (concierge + read-only queries) | [Workspace assistant](/teams/workspace-assistant/) |
| Skill Marketplace (reusable markdown skills for agents) | [Skill Marketplace](/teams/skill-marketplace/) |
| Per-workspace publish governance (approval before going public) | [Admin](/teams/admin/#publishing-policy) |
| Workspace context files (agent house style) | [Workspaces](/teams/workspaces/) |
| Workspace admin (schedules, automations, alerts) | [Admin](/teams/admin/) |
| External sharing (Clients, portal, scoped API, receipts) | [External sharing](/teams/external-sharing/) |
| Seat usage | This page |
| Configurable session length policy | [Admin](/teams/admin/) |
| Workspace audit log | [Admin](/teams/admin/) |
| Teams REST API | [API reference](/teams/api/) |

## Workspace roles

| Role | Capabilities |
| --- | --- |
| `owner` | Full workspace control. |
| `admin` | Manage members, policy, subdomain, settings, schedules, automations. |
| `member` | Create/edit own artifacts; view workspace-visible artifacts. |

Do not confuse workspace roles (`owner`/`admin`/`member`) with artifact
collaborator roles (`owner`/`editor`/`viewer`).

## Artifact visibility

| Value | Who can view |
| --- | --- |
| `private` | Owner plus explicit collaborators. Default. |
| `workspace` | Every member of the artifact's workspace. |
| `public` | Anyone on the internet with the link; discoverable. |

Use `visibility: "workspace"` only when the artifact has a `workspace_id` set.

<Aside type="caution">
Teams-only endpoints return `402 TIER_REQUIRED` with `required_tier: "team"` when
called from a Personal account.
</Aside>
