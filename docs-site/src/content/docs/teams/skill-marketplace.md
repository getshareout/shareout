---
title: Skill Marketplace
description: Per-workspace catalog of reusable markdown skills — publish, rank, attach to artifacts for the authoring agent.
---

import { Aside } from '@astrojs/starlight/components';

The **Skill Marketplace** is a per-workspace catalog of
reusable **skills** — markdown playbooks published as artifacts. Members browse,
upvote, and save skills in the **Library** lens, then attach them to
other artifacts so the **authoring** AI agent reuses them when editing.

<Aside type="note">
Skills are distinct from [workspace context files](/teams/workspaces/#workspace-context-files)
(admin-curated, always-on, build-time). Skills are member-published, opt-in per
artifact, and inject into the authoring chat only — never the visitor chat.
</Aside>

## Availability

No plan requirement — the only rule is that a skill belongs to a workspace. A
personal (non-workspace) publish with `artifact_type: "skill"` is rejected with
`400 SKILL_REQUIRES_WORKSPACE`.

In the ShareOut app, skills live in the **Library** lens, which opens on its
**Skills** tab: search, filter by category, publish, read, edit, review changes,
and install the catalog into an agent.

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

Optional YAML frontmatter. Use `name` and `description` — the Agent Skills keys
every client reads:

```markdown
---
name: brand-guidelines
description: How we brand dashboards
category: Design
tags: ui, branding
version: 1.2.0
---

# Brand skill

Body content…
```

| Field | Purpose |
| --- | --- |
| `name` | Skill id for an Agent Skills client. Derived from the slug when absent. |
| `description` | What the skill is for — the card blurb, and what an agent matches on. |
| `category` | Filter/group in the Library |
| `tags` | Search terms |
| `version` | Display version |

`summary:` still works as a legacy spelling. Whatever the author wrote, every byte
ShareOut serves for download or install carries normalized `name` + `description`,
so the file registers with Claude Code, Cursor and anything else reading the
convention.

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

Simpler, when all you have is a name and a body:

```http
POST /v1/workspaces/{workspaceId}/skills
```

```json
{ "name": "Deploy checklist", "markdown": "# Deploy checklist\n\n…", "category": "Engineering" }
```

This is what the Library's **New skill** button and the assistant's `save_skill`
tool call.

## Who can change a skill

| `edit_policy` | May republish directly | May propose a change |
| --- | --- | --- |
| `owner_only` *(default)* | Skill owner, or an artifact `editor` | — |
| `workspace` | Any workspace member | — |
| `approval` | Skill owner / artifact `editor` | Any workspace member |

```http
PUT /v1/skills/{skillId}/policy        ← { "edit_policy": "approval" }
PUT /v1/workspaces/{workspaceId}/skill-policy
                                       ← { "default_skill_edit_policy": "workspace" }
PUT /v1/skills/{skillId}/markdown      ← { "markdown": "# …" }
```

Setting a policy needs the skill's owner or a workspace admin. The workspace default
applies to **new** skills only. Under `approval`, saving returns
`409 SKILL_REQUIRES_APPROVAL` and points at the change-request route:

```http
GET    /v1/skills/{skillId}/changes
POST   /v1/skills/{skillId}/changes             ← { "markdown", "title?", "note?" }
POST   /v1/skills/{skillId}/changes/{changeId}  ← { "action": "merge|reject|withdraw" }
```

Nothing is applied until a merge, which republishes the skill as a new version.

## Install into an agent

```bash
curl -fsSL https://shareout.site/v1/skills/install.sh | sh -s -- --workspace <slug-or-id>
```

Writes every skill in the workspace to `~/.claude/skills/<name>/SKILL.md`. Re-run to
re-sync. `--target cursor` writes `.cursor/rules/<name>.mdc`; `--list` previews.

```http
GET /v1/skills/{skillId}/raw                      → text/markdown
GET /v1/workspaces/{workspaceId}/skills/index.json → agentskills.io discovery shape
```

The instance's `/.well-known/agent-skills/index.json` lists the official skills with
no token at all.

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
