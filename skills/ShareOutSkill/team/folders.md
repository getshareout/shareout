# Team Space Folders

**Team Space folders** are the shared folder structure inside a Teams workspace. Every workspace member can see them and organize artifacts within them; only workspace **admins** and **owners** can create, rename, or delete folders.

> **Personal folders** (outside any workspace) are documented in [../api/folders.md](../api/folders.md).

## Concepts

| Scope | Who sees it | Who creates folders | API prefix |
|-------|-------------|---------------------|------------|
| **Team Space** | All workspace members | `owner` / `admin` only | `/v1/workspaces/{id}/folders` |
| **Personal** | Owner (+ linked accounts) | Owner | `/v1/folders` |

The home UI labels workspace folders **"Team Space · {workspace name}"**. Members who try to create a Team Space folder receive `403 ADMIN_REQUIRED`.

## Endpoints

```http
GET    /v1/workspaces/{workspaceId}/folders
POST   /v1/workspaces/{workspaceId}/folders
GET    /v1/workspaces/{workspaceId}/folders/{folderId}
PATCH  /v1/workspaces/{workspaceId}/folders/{folderId}
DELETE /v1/workspaces/{workspaceId}/folders/{folderId}
GET    /v1/workspaces/{workspaceId}/folders/by-path/{path}
POST   /v1/workspaces/{workspaceId}/artifacts/{artifactId}/move
```

All routes require workspace membership. Create/delete/patch require `owner` or `admin`.

## List folders

```http
GET /v1/workspaces/{workspaceId}/folders?parent_id={folderId}
Authorization: Bearer {token}
```

Omit `parent_id` for top-level folders. Response includes `artifact_count`, `subfolder_count`, `visibility`, and `parent_id` for nesting.

## Create folder

```http
POST /v1/workspaces/{workspaceId}/folders
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Q1 Reports",
  "slug": "q1-reports",
  "description": "Quarterly dashboards",
  "parent_id": null,
  "visibility": "inherit",
  "readme": "# Q1 Reports\n\nExec audience. Use the brand palette, pull from the `sales` dataset, keep private until reviewed."
}
```

- `visibility`: `inherit` (default), `private`, `workspace`, `public` — controls who sees artifacts filed here when artifact visibility inherits from folder.
- Slugs are unique per parent level within the workspace.
- `readme`: optional markdown **folder guide** — see below.

## Folder guide (README) — the instruction surface for agents

Every folder can carry a **guide**: a markdown `readme` describing what belongs in the folder and how to build for it — conventions, brand, data sources, audience, publishing rules. It is shown at the top of the folder in the app (human-readable) **and it is meant for agents**.

**If you are an agent about to build or publish an artifact into a folder, `GET` the folder first and follow its `readme`.** Treat it as the folder's local system prompt: honor its conventions before you write anything. ShareOut's own in-app editing agent already receives the guide of the folder an artifact lives in.

Set or update it with the `readme` field on create or `PATCH`:

```http
PATCH /v1/workspaces/{workspaceId}/folders/{folderId}
Authorization: Bearer {token}
Content-Type: application/json

{ "readme": "# Q1 Reports\n\nExec audience. Brand palette only. Source: `sales` dataset. Private until reviewed." }
```

- `readme` is freeform markdown. Send `""` to clear it.
- `GET /v1/workspaces/{workspaceId}/folders/{folderId}` returns `readme`.
- Team Space guides are set by `owner`/`admin`; personal folder guides by the owner (`PATCH /v1/folders/{id}`).

## Move artifact into a folder

```http
POST /v1/workspaces/{workspaceId}/artifacts/{artifactId}/move
Authorization: Bearer {token}
Content-Type: application/json

{ "folder_id": "fld_abc" }
```

Any workspace member can move a workspace artifact. Pass `"folder_id": null` to unfile.

## URL paths

Folder slugs appear in subdomain and namespaced URLs:

| Pattern | Example |
|---------|---------|
| `{ws}.example.com/{folder}/{artifact-slug}` | `acme.example.com/q1-reports/sales-dashboard` |
| `$ORIGIN_HOST/@{ws}/{folder}/{artifact-slug}` | `$ORIGIN_HOST/@acme/q1-reports/sales-dashboard` |

Artifact slugs in these URLs are the **human slug** (`display_slug`), unique per workspace. See [../api/artifacts.md](../api/artifacts.md#slugs-human-vs-routing).

## Related

- [SKILL.md](SKILL.md) — workspace roles
- [subdomain.md](subdomain.md) — subdomain routing with folders
- [../api/folders.md](../api/folders.md) — personal folders
