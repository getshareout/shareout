# ShareOut Workspace Index

Workspace overlay navigation. Load [../SKILL.md](../SKILL.md) first, then this file for
**workspace administration** (members, governance, connectors, …).

There are no paid plan gates — use workspace **roles**, not Personal/Pro/Teams
language.

## Quick Discovery

| User intent | Load first | Then if needed |
| --- | --- | --- |
| Workspace roles / who can admin | [SKILL.md](SKILL.md#workspace-roles) | [api.md](api.md#members-and-roles) |
| Internal workspace artifact | [SKILL.md](SKILL.md#workspace-visibility) | [../modules/_shared/permissions.md](../modules/_shared/permissions.md) |
| Members, roles, invites | [api.md](api.md#members-and-roles) | [SKILL.md](SKILL.md#workspace-roles) |
| Allow domains/emails into a workspace | [api.md](api.md#workspace-membership-policy) | [SKILL.md](SKILL.md#workspace-membership-policy) |
| Custom workspace subdomain | [subdomain.md](subdomain.md) | [../deploy/cloudflare.md](../deploy/cloudflare.md) |
| Workspace house style for agents | [workspace-context.md](workspace-context.md) | [SKILL.md](SKILL.md#workspace-context-files) |
| Workspace schedules / automations | [api.md](api.md#workspace-schedules-and-automations) | [../api/jobs.md](../api/jobs.md) |
| Team-wide metric alert management | [../api/metric-alerts.md](../api/metric-alerts.md) | [api.md](api.md#metric-alerts-in-teams) |
| Workspace connections | [workspace-connections.md](workspace-connections.md) | [api.md](api.md#workspace-connections) |
| Data catalog / lineage / glossary | [catalog.md](catalog.md) | [workspace-connections.md](workspace-connections.md) |
| One-shot deliver artifact | [../core/workspace-home.md](../core/workspace-home.md#inspector-right-rail) | [api.md](api.md#artifact-delivery-one-shot) |
| Workspace assistant (home chat) | [workspace-assistant.md](workspace-assistant.md) | [admin-portal.md](admin-portal.md) · [../api/features.md](../api/features.md) |
| Workspace admin portal | [admin-portal.md](admin-portal.md) | [api.md](api.md) · [../api/support.md](../api/support.md) |
| Home lenses | [../core/workspace-home.md](../core/workspace-home.md#workspace-lenses) | [SKILL.md](SKILL.md#workspace-admin-surfaces) |
| Workspace Knowledge | [knowledge.md](knowledge.md) | [workspace-context.md](workspace-context.md) |
| Asset library / deliverables | [assets.md](assets.md) | [../sdk/files.md](../sdk/files.md) |
| Workspace file inbox | [assets.md](assets.md#add-files-without-opening-assets) | [workspace-assistant.md](workspace-assistant.md#file-attachments) |
| Build a page from an uploaded file | [workspace-assistant.md](workspace-assistant.md#file-attachments) | [assets.md](assets.md) |
| Home activity feed | [activity-feed.md](activity-feed.md) | [../core/workspace-home.md](../core/workspace-home.md) |
| Notifications panel | [../core/workspace-home.md](../core/workspace-home.md#notifications) | [api.md](api.md#home-activity) |
| Pro search (⌘K) | [../core/workspace-home.md](../core/workspace-home.md#pro-search-k) | [../api/search.md](../api/search.md) |
| Metric watch | [../api/metric-watch.md](../api/metric-watch.md) | [../core/workspace-home.md](../core/workspace-home.md#inspector-right-rail) |
| Gate public publishes | [publish-governance.md](publish-governance.md) | [../modules/_shared/publishing.md](../modules/_shared/publishing.md) |
| Skill marketplace | [skill-marketplace.md](skill-marketplace.md) | [workspace-context.md](workspace-context.md) |
| Official / Recommended skills | [skill-marketplace.md](skill-marketplace.md#official-skills-recommended-by-shareout) | `GET /v1/skills/recommended` |
| Workspace library (`so.lib`) | [libraries.md](libraries.md) | [../sdk/libraries.md](../sdk/libraries.md) |
| Share a table across artifacts | [workspace-tables.md](workspace-tables.md) | [../sdk/table.md](../sdk/table.md) |
| Per-user API tokens | [workspace-connections.md](workspace-connections.md#member-save-personal-credentials) | [../sdk/live-data.md](../sdk/live-data.md) |
| Agent token (CI / service account) | [agent-tokens.md](agent-tokens.md) | [api.md](api.md#members-and-roles) |
| Team Space folders | [folders.md](folders.md) | [subdomain.md](subdomain.md) |
| External sharing (clients) | [external-sharing.md](external-sharing.md) | [admin-portal.md](admin-portal.md) |
| Session policy / audit log | [api.md](api.md#session-policy) | [api.md](api.md#audit-log) |
| Feature disabled for a workspace | [../api/features.md](../api/features.md) | [../api/errors.md](../api/errors.md) |

## File Tree

```text
ShareOutSkill/team/
├── SKILL.md                  # Workspace overlay entrypoint
├── INDEX.md                  # This router
├── api.md                    # Workspace REST endpoints
├── subdomain.md              # Workspace subdomain behavior
├── workspace-context.md
├── workspace-connections.md
├── workspace-assistant.md
├── admin-portal.md
├── activity-feed.md
├── publish-governance.md
├── skill-marketplace.md
├── libraries.md
├── assets.md
├── knowledge.md
├── agent-tokens.md
├── workspace-tables.md
├── folders.md
└── external-sharing.md
```

## Term Boundaries

| Term | Means |
| --- | --- |
| Workspace role | Workspace `owner`, `admin`, or `member`. |
| Collaborator role | Artifact `owner`, `editor`, or `viewer`. |
| Workspace membership policy | Email/domain rules for joining a workspace. |
| Artifact access policy | Row-level data filtering inside an artifact. |
| Workspace context | House-style markdown files for agents. |
| Plan / Pro / Teams | **Hosted product labels only.** Ignore on self-host; use roles + features. |
