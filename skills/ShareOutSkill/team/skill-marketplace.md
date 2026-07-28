# Skill Marketplace

The **Skill Marketplace** is a Teams/Enterprise feature: a per-workspace catalog of reusable **skills** — markdown playbooks published as artifacts. Members browse, upvote, and save skills in the left-nav **Skill Market**, then attach them to other artifacts so the **authoring** AI agent reuses them when editing.

Skills are distinct from [workspace context files](workspace-context.md) (admin-curated, always-on, build-time). Skills are member-published, opt-in per artifact, and inject into the **authoring** chat only — never the visitor chat. See [../agents/overview.md](../agents/overview.md) for visitor vs authoring agents.

Load [SKILL.md](SKILL.md) first.

## Availability

Requires a **Teams or Enterprise** plan on the workspace owner. Personal workspaces cannot publish skills (`402 TEAMS_PLAN_REQUIRED`).

In the ShareOut app, open a team workspace and select **Skill Market** in the left navigation. Open any skill from **Library** or the marketplace to read it in the in-Studio **skill viewer** (rendered markdown with copy/download).

## What is a skill?

A skill is a `.md` file published with `artifact_type: "skill"`. It is stored as markdown internally but served with a dedicated skill viewer when listed in the marketplace.

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
Authorization: Bearer {token}
Content-Type: application/json
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

## Official skills (Recommended by ShareOut)

Every workspace's **Library** lens (personal and team tabs) shows a read-only **Recommended by ShareOut** strip — curated official skills seeded from a hidden system workspace and kept fresh by a daily sync. They appear in browse results with `official: true` and can be **attached to artifacts in any workspace** (cross-workspace attach is normally blocked for member-published skills).

```http
GET /v1/skills/recommended
Authorization: Bearer {token}
```

Workspace-agnostic — any signed-in user (free included). Returns `{ "skills": [ { "slug", "artifact_id", "name", "summary", "category", "tags", "attribution?", "uses", "url", "official": true }, … ] }` ordered by `official_rank`. Display fields come from the platform registry; metrics and ids come from the published artifacts.

Official skills are not editable or votable like member skills — browse, open, install, and attach only. The canonical ShareOut skill (`shareout`) is always included so teams start with the latest agent playbook.

## Browse & rank

```http
GET /v1/workspaces/{workspaceId}/skills?sort=top&category=Design&q=brand&limit=30
GET /v1/workspaces/{workspaceId}/skills/categories
GET /v1/workspaces/{workspaceId}/skills/installed
Authorization: Bearer {token}
```

| `sort` | Order |
| --- | --- |
| `top` *(default)* | Featured first, then score (upvotes ×3 + attaches ×2 + installs ×1) |
| `trending` | Score with time decay |
| `new` | Most recently published |
| `installed` | Use `/skills/installed` instead |

Each card includes `upvotes`, `installs`, `attaches`, `uses` (display-only), `voted`, and `installed` for the current user.

## Upvote & save

```http
POST   /v1/artifacts/{skillId}/skill/vote
DELETE /v1/artifacts/{skillId}/skill/vote

POST   /v1/artifacts/{skillId}/skill/install
DELETE /v1/artifacts/{skillId}/skill/install
```

All require workspace membership. Votes and installs are idempotent toggles.

## Attach to an artifact

Attach up to **5** skills per artifact (version-pinned). Attached skills load into the **authoring** agent's system prompt when editing that artifact — not into the visitor chat. Content is treated as untrusted reference, char-budgeted, and deduped per conversation.

```http
GET  /v1/artifacts/{artifactId}/skills
POST /v1/artifacts/{artifactId}/skills
POST /v1/artifacts/{artifactId}/skills/{skillId}
DELETE /v1/artifacts/{artifactId}/skills/{skillId}
Authorization: Bearer {token}
```

Attach body:

```json
{ "skill_artifact_id": "art_skill", "position": 0 }
```

`POST …/skills/{skillId}` bumps the attachment to the skill's latest published version.

At publish time you can also pass `attached_skill_ids: ["art_skill1", "art_skill2"]` on a **non-skill** artifact.

Requires artifact `editor`+ role. Member-published skills must belong to the same workspace as the target artifact. **Official skills** (`official: 1`) may attach cross-workspace.

## Attach to your agent (personal curation)

Separate from per-artifact attachments: each member can attach up to **8** skills to **their own** workspace assistant (Home chat, Telegram, Slack). These load as reference material in every conversation that member runs — not into visitor chat and not into other members' agents.

In **Library**, official and workspace skill cards show **Attach to agent** / **Attached to agent**. Scope is the workspace id, or `__personal` for personal Home chat.

```http
GET  /v1/workspaces/{scope}/agent-skills
POST /v1/workspaces/{scope}/agent-skills   ← { "skill_artifact_id": "art_skill" }
DELETE /v1/workspaces/{scope}/agent-skills/{skillId}
```

`GET /v1/skills/{skillId}/markdown` returns raw `SKILL.md` for the viewer (signed-in; skill must be official or visible to you).

## Admin moderation

Workspace admins can feature or block a skill:

```http
PATCH /v1/artifacts/{skillId}/skill/admin
Authorization: Bearer {token}
Content-Type: application/json

{ "featured": true }
```

```json
{ "blocked": true }
```

Blocked skills disappear from the catalog.

## Where skills appear in the app

Attached skills are visible to editors and signed-in viewers — but only **inject into the authoring agent**, never visitor chat.

| Surface | Who sees it | What |
| --- | --- | --- |
| **Library lens — Recommended by ShareOut** | Any signed-in user | Read-only strip of official skills (personal + team Library tabs). |
| **Skill Market** (left nav) | Workspace members | Browse, upvote, save, and publish skills. |
| **Home artifact cards** | Signed-in owner/editor | **Skills** feature badge when attachments exist. |
| **Home stats modal** | Signed-in owner/editor | **Attached skills** panel (attach/detach picker requires workspace context). |
| **Editor Details rail** | `editor`+ | Read-only skill chips linking to each attached skill. |
| **Viewer toolbar** | Signed-in viewers with access | **Skills N** button opens a read-only popover listing attached skills (anonymous views unchanged). |
| **Library — skill viewer** | Any signed-in user with access | In-Studio modal: rendered markdown, copy, download `.md` or Claude `.zip`. |
| **Library — Attach to agent** | Member | Toggle up to **8** skills into Home / Telegram / Slack assistant context. |

## Agent checklist

- Offer to publish a skill when a team wants reusable playbooks (brand voice, SQL patterns, report structure).
- Attach skills to artifacts you build or update so the studio agent inherits team conventions.
- Never confuse skills with workspace context — context is admin-managed and always-on; skills are opt-in per artifact.
- Visitor-facing `sdk.agent` chat does **not** load attached skills.

## Related

- [workspace-context.md](workspace-context.md) — always-on admin context files
- [../agents/overview.md](../agents/overview.md) — visitor vs authoring agents
- [api.md](api.md#skill-marketplace) — endpoint table
- [SKILL.md](SKILL.md#workspace-admin-surfaces) — admin surfaces
