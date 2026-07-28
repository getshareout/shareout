# Teams Workspace Context

Workspace context files are optional markdown files that teach agents a team's house style: brand, voice, conventions, and data definitions.

Load [SKILL.md](SKILL.md) first.

## Consume Context

When a Teams workspace slug/id and token are available, prefer:

```http
GET /v1/skill?workspace={workspaceSlugOrId}
Authorization: Bearer {token}
```

The response is the base skill zip with an extra `workspace-context.md` when the requester is a workspace member. If there is no context, proceed with the normal zip bundle.

To fetch files directly:

```http
GET /v1/workspaces/{workspaceId}/context
GET /v1/workspaces/{workspaceId}/context/{name}
```

## Manage Context

Writes require workspace `admin` or `owner`.

**Admin UI:** Home → **Knowledge** lens → **Guidance** branch (or manage via REST). Lists every `.md` file with size and last-updated, marks the entry point, and lets admins create (≤64KB, lowercase `*.md`), edit in a markdown editor, set the entry file, or delete. Same data as the REST routes below. The standalone Admin → Intelligence tab was retired — Guidance lives in Knowledge. See [knowledge.md](knowledge.md) and [admin-portal.md](admin-portal.md).

```http
PUT    /v1/workspaces/{workspaceId}/context/{name}
DELETE /v1/workspaces/{workspaceId}/context/{name}
PUT    /v1/workspaces/{workspaceId}/context
```

`PUT /context` sets the entry filename:

```json
{ "entry": "index.md" }
```

**Per-client notes:** Clients (external sharing orgs) can also have private markdown notes scoped with `sharee_id` — same storage model, different API prefix (`/sharees/{sid}/context`). The workspace assistant auto-reads them and can update them via `set_client_notes`. See [external-sharing.md](external-sharing.md#client-notes-ai-memory-about-a-client).

## Recommended Files

| File | Holds |
| --- | --- |
| `index.md` | Short entry point, golden rules, and links to topic files. |
| `style.md` | Colors, fonts, layout, logo, charts. |
| `voice.md` | Tone, terminology, words to use/avoid. |
| `conventions.md` | Report/dashboard structure and recurring patterns. |
| `data.md` | Warehouse connections, **workspace connector names** (`shared` vs `per_user`), metric definitions, key tables. |

Keep `index.md` short. Load topic files only when needed.

## Bootstrap Rules

Only bootstrap context when a Teams admin/owner asks for it. Do not create workspace context for Personal users or normal workspace members.

If bootstrapping from public materials, explain assumptions and ask the admin to confirm. Use real content, not placeholders.
