---
title: Skill Marketplace
description: Per-workspace catalog of reusable markdown skills — publish, rank, attach to artifacts for the authoring agent.
---

import { Aside } from '@astrojs/starlight/components';

The **Skill Marketplace** is a Teams/Enterprise feature: a per-workspace catalog of
reusable **skills** — markdown playbooks published as artifacts. Members browse,
upvote, and save skills in the left-nav **Skill Market**, then attach them to
other artifacts so the **authoring** AI agent reuses them when editing.

<Aside type="note">
Skills are distinct from [workspace context files](/teams/workspaces/#workspace-context-files)
(admin-curated, always-on, build-time). Skills are member-published, opt-in per
artifact, and inject into the authoring chat only — never the visitor chat.
</Aside>

## Availability

Requires a **Teams or Enterprise** plan on the workspace owner. Personal
workspaces cannot publish skills (`402 TEAMS_PLAN_REQUIRED`).

In the ShareOut app, open a team workspace and select **Skill Market** in the
left navigation. Open any skill from **Library** or the marketplace to read it in
the in-Studio **skill viewer** (rendered markdown with copy/download).

## Recommended by ShareOut

Every workspace **Library** lens shows a **Recommended by ShareOut** strip at the
top — curated official skills (ShareOut authoring, design, TDD, domain modeling,
and more) maintained by ShareOut and kept fresh by a daily sync. They are
read-only, available on **all plans** (including personal workspaces), and
attachable cross-workspace like any other skill.

```http
GET /v1/skills/recommended
Authorization: Bearer {token}
```

Returns `{ skills: [{ slug, artifact_id, name, summary, category, tags, attribution?, uses, url, official: true }] }`.
Workspace-agnostic — any signed-in user can list them. Official skills live in a
hidden system workspace; the endpoint surfaces display metadata from the registry
plus live artifact ids and use counts.

## What is a skill?

A skill is a `.md` file published with `artifact_type: "skill"`. It is stored as
markdown internally but served with a dedicated skill viewer when listed in the
marketplace.

Skills are always `workspace`-visible so every member can browse the catalog.

### Frontmatter

Optional YAML frontmatter in the markdown entrypoint:

```markdown
---
category: Design
tags: ui, branding
version: 1.2.0
summary: How we brand dashboards
---

# Brand skill

Body content…
```

| Field | Purpose |
| --- | --- |
| `category` | Filter/group in the marketplace |
| `tags` | Search chips |
| `version` | Display version |
| `summary` | Card blurb (falls back to first paragraph) |

## Publish a skill

```http
POST /v1/publish
```

```json
{
  "name": "Brand guidelines",
  "slug": "brand-guidelines",
  "artifact_type": "skill",
  "workspace_id": "wsp_abc",
  "files": [
    { "path": "skill.md", "content": "---\ncategory: Design\n---\n# …", "mime": "text/markdown" }
  ]
}
```

`workspace_id` is required. Visibility is forced to `workspace`.

## Browse & rank

```http
GET /v1/workspaces/{id}/skills?sort=top&category=Design&q=brand&limit=30
GET /v1/workspaces/{id}/skills/categories
GET /v1/workspaces/{id}/skills/installed          ← "My Skills" saved list
```

| `sort` | Order |
| --- | --- |
| `top` (default) | Featured first, then score (upvotes ×3 + attaches ×2 + installs ×1) |
| `trending` | Score with time decay |
| `new` | Most recently published |
| `installed` | Use `/skills/installed` instead |

Each card includes `upvotes`, `installs`, `attaches`, `uses` (display-only),
`voted`, and `installed` for the current user.

## Upvote & save

```http
POST   /v1/artifacts/{skillId}/skill/vote      ← upvote (idempotent)
DELETE /v1/artifacts/{skillId}/skill/vote      ← remove vote

POST   /v1/artifacts/{skillId}/skill/install    ← save to My Skills
DELETE /v1/artifacts/{skillId}/skill/install    ← unsave
```

## Attach to an artifact

Attach up to **5** skills per artifact (version-pinned). Attached skills load into
the **authoring** agent's system prompt when editing that artifact — not into the
visitor chat.

### Where attached skills appear

| Surface | Who sees it |
| --- | --- |
| **Home** artifact cards | Skills badge when the artifact has attachments |
| **Stats** modal → Attached skills | Any artifact with skills; attach/detach picker requires a team workspace |
| **Editor** Details rail → Skills | Read-only list while editing |
| **Viewer** floating toolbar → **Skills N** | Signed-in viewers (collaborators, workspace members); opens a read-only popover linking to each skill artifact. Anonymous visitors do not see it. |

```http
GET  /v1/artifacts/{artifactId}/skills
POST /v1/artifacts/{artifactId}/skills          ← { "skill_artifact_id": "art_skill", "position": 0 }
POST /v1/artifacts/{artifactId}/skills/{skillId}  ← bump to latest skill version
DELETE /v1/artifacts/{artifactId}/skills/{skillId}
```

At publish time you can also pass `attached_skill_ids: ["art_skill1", "art_skill2"]`
on a non-skill artifact.

Requires artifact `editor`+ role. Skills must belong to the same workspace as the
target artifact.

## Attach to your agent (personal curation)

Separate from per-artifact attachments: each member can attach up to **8** skills to
**their own** workspace assistant (Home chat, Telegram, Slack). These load as reference
material in every conversation that member runs — not into visitor chat and not into
other members' agents.

In **Library**, official and workspace skill cards show **Attach to agent** / **Attached
to agent**. Scope is the workspace id, or `__personal` for personal Home chat.

```http
GET  /v1/workspaces/{scope}/agent-skills
POST /v1/workspaces/{scope}/agent-skills   ← { "skill_artifact_id": "art_skill" }
DELETE /v1/workspaces/{scope}/agent-skills/{skillId}
```

`GET /v1/skills/{skillId}/markdown` returns raw `SKILL.md` for the viewer (signed-in;
skill must be official or visible to you).

## Admin moderation

Workspace admins can feature or block a skill:

```http
PATCH /v1/artifacts/{skillId}/skill/admin
{ "featured": true }
{ "blocked": true }
```

Blocked skills disappear from the catalog.

## Related

- [Teams API](/teams/api/) — full endpoint list
- [AI chat agent](/guides/ai-agent/) — visitor vs authoring agents
- [Workspace context files](/teams/workspaces/#workspace-context-files) — always-on admin docs
