# Skill Marketplace

The **Skill Marketplace** is a Teams/Enterprise feature: a per-workspace catalog of reusable **skills** — markdown playbooks published as artifacts. Members browse, upvote, and save skills in the left-nav **Skill Market**, then attach them to other artifacts so the **authoring** AI agent reuses them when editing.

Skills are distinct from [workspace context files](workspace-context.md) (admin-curated, always-on, build-time). Skills are member-published, opt-in per artifact, and inject into the **authoring** chat only — never the visitor chat. See [../agents/overview.md](../agents/overview.md) for visitor vs authoring agents.

Load [SKILL.md](SKILL.md) first.

## Availability

No tier requirement — the only rule is that skills must belong to a workspace. A personal (non-workspace) artifact publish with `artifact_type: "skill"` is rejected with `400 SKILL_REQUIRES_WORKSPACE` ("Skills must be published to a workspace").

In the ShareOut app, skills live in the **Library** lens, which opens on its **Skills** tab. Search, filter by category, publish a new one, open any skill to read it, and install the whole catalog into an agent from there.

## What is a skill?

A skill is a `.md` file published with `artifact_type: "skill"`. It is stored as markdown internally but served with a dedicated skill viewer when listed in the marketplace.

Skills are always `workspace`-visible so every member can browse the catalog.

### Frontmatter

Optional YAML frontmatter in the markdown entrypoint. Write `name` and `description`
— the Agent Skills keys every client reads:

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
| `name` | Skill id for an Agent Skills client (lowercase, hyphens). Derived from the slug when absent. |
| `description` | What the skill is for — the card blurb, and what an agent matches on. Falls back to the first paragraph. |
| `category` | Filter/group in the Library |
| `tags` | Search terms |
| `version` | Display version (free text; the artifact's own `version_no` is the real one) |

`summary:` is accepted as a legacy spelling of `description` and is rewritten on the
way out. Whatever the author wrote, every byte ShareOut serves for download or install
carries normalized `name` + `description`, so the file registers with Claude Code,
Cursor and anything else that reads the convention.

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

Simpler, when all you have is a name and a body — no files array, no artifact type,
and the workspace in the path:

```http
POST /v1/workspaces/{workspaceId}/skills
Authorization: Bearer {token}
Content-Type: application/json

{ "name": "Deploy checklist", "markdown": "# Deploy checklist\n\n…", "category": "Engineering" }
```

→ `201 { artifact_id, version_no, slug, url }`, or `409 SLUG_TAKEN`.

In chat, the assistant does this with **`save_skill`** (see [Agent tools](#agent-tools)).

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

```http
POST /v1/workspaces/{scope}/agent-skills/{skillId}
```

Re-pins an attached skill to the skill's current version. An attachment stores the
version it was made at, so without this the member's agent keeps loading the body from
the day they attached. `GET …/agent-skills` returns `version_no`, `latest_version_no`
and `outdated` so the Library can show an **Update to vN** button.

`GET /v1/skills/{skillId}/markdown` returns the body plus `html`, `version_no`,
`edit_policy` and the caller's `can_edit` / `can_propose` / `can_review` /
`can_set_policy` flags (signed-in; the skill must be official or in a workspace you
belong to).

## Who can change a skill

A skill is the team's source of truth, so "only its author may edit it" is often the
wrong rule. `edit_policy` is set per skill:

| `edit_policy` | May republish directly | May propose a change |
| --- | --- | --- |
| `owner_only` *(default)* | Skill owner, or an artifact `editor` collaborator | — |
| `workspace` | Any workspace member | — |
| `approval` | Skill owner / artifact `editor` | Any workspace member |

```http
PUT /v1/skills/{skillId}/policy        ← { "edit_policy": "approval" }
PUT /v1/workspaces/{workspaceId}/skill-policy
                                       ← { "default_skill_edit_policy": "workspace" }
```

Setting a skill's policy needs the skill's owner or a workspace admin. The workspace
default applies to **new** skills only — changing it never reopens a skill somebody
already locked down.

Saving a new body:

```http
PUT /v1/skills/{skillId}/markdown      ← { "markdown": "# …" }
```

→ `200 { version_no, via }`. Under `approval` a member gets `409
SKILL_REQUIRES_APPROVAL` with a hint pointing at the change-request route — that is
routing, not refusal.

### Proposed changes

```http
GET    /v1/skills/{skillId}/changes[?status=open]
POST   /v1/skills/{skillId}/changes             ← { "markdown", "title?", "note?" }
GET    /v1/skills/{skillId}/changes/{changeId}  → proposal + current body to compare
POST   /v1/skills/{skillId}/changes/{changeId}  ← { "action": "merge|reject|withdraw" }
```

Nothing is applied until a merge, which republishes the skill as an ordinary new
version. `merge`/`reject` need the owner, an artifact editor or a workspace admin;
`withdraw` is the proposer's own. A proposal written against an older version stays
open with its `base_version_no` visible rather than being silently discarded.

## Install into an agent

```http
GET /v1/skills/{skillId}/raw
```

`text/markdown` with normalized `name` + `description` frontmatter — redirect it to a
file and an Agent Skills client picks it up. Official skills need no token; workspace
skills need membership. `X-Skill-Version` carries the version.

```http
GET /v1/workspaces/{workspaceId}/skills/index.json
```

The workspace catalog in the [agentskills.io](https://schemas.agentskills.io) discovery
shape — the same shape as the instance's own `/.well-known/agent-skills/index.json`,
which also lists the official skills. Each entry links to its `/raw`.

```bash
curl -fsSL $ORIGIN/v1/skills/install.sh | sh -s -- --workspace <slug-or-id>
```

Writes every skill in the workspace to `~/.claude/skills/<name>/SKILL.md`. Re-run it
to re-sync. `--target cursor` writes `.cursor/rules/<name>.mdc`; `--target dir --dir
<path>` writes anywhere; `--list` prints the catalog. The token comes from
`SHAREOUT_TOKEN` or `~/.shareout/credentials`.

## Agent tools

The workspace assistant (Home chat, Telegram, Slack) carries three skill tools:

| Tool | What it does |
| --- | --- |
| `list_skills` | The workspace catalog, with each skill's `edit_policy` and whether it is the user's own. |
| `read_skill` | One skill's full body. Read before updating so the change builds on the current text. |
| `save_skill` | Publish a new skill, or a new version of one (`skill_id`). The user confirms first. Where the policy requires review, it opens a change request instead of failing. |

Skills also appear in search: `search_workspace` and `GET /v1/search` take
`groups=skills`, and they surface in the Cmd+K palette.

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
| **Library lens — Skills tab** | Workspace members | Search, filter, publish, upvote, save, edit, review changes, install. |
| **Home artifact cards** | Signed-in owner/editor | **Skills** feature badge when attachments exist. |
| **Home stats modal** | Signed-in owner/editor | **Attached skills** panel (attach/detach picker requires workspace context). |
| **Editor Details rail** | `editor`+ | Read-only skill chips linking to each attached skill. |
| **Viewer toolbar** | Signed-in viewers with access | **Skills N** button opens a read-only popover listing attached skills (anonymous views unchanged). |
| **Library — skill viewer** | Any workspace member | In-Studio modal: rendered markdown, copy, download `.md` or Claude `.zip`, edit or propose a change, set the edit policy. |
| **Library — Attach to agent** | Member | Toggle up to **8** skills into Home / Telegram / Slack assistant context. |

## Agent checklist

- Offer to publish a skill when a team wants reusable playbooks (brand voice, SQL patterns, report structure).
- Attach skills to artifacts you build or update so the studio agent inherits team conventions.
- Use `save_skill` when someone wants a playbook kept for the team; read it first with `read_skill` when updating.
- When a skill should be kept current by everyone, set `edit_policy: "workspace"`; when changes need a second pair of eyes, `"approval"`.
- Point people at `curl $ORIGIN/v1/skills/install.sh` rather than downloading skills one at a time.
- Never confuse skills with workspace context — context is admin-managed and always-on; skills are opt-in per artifact.
- Visitor-facing `sdk.agent` chat does **not** load attached skills.

## Related

- [workspace-context.md](workspace-context.md) — always-on admin context files
- [../agents/overview.md](../agents/overview.md) — visitor vs authoring agents
- [api.md](api.md#skill-marketplace) — endpoint table
- [SKILL.md](SKILL.md#workspace-admin-surfaces) — admin surfaces
