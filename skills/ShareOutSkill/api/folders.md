# Personal Folders

Personal folders organize artifacts in the owner's **private** home catalog — outside any workspace. They are visible only to the owner (and linked accounts on the same home grid).

> **Teams workspaces** use **Team Space folders** instead — shared with all workspace members. See [../team/folders.md](../team/folders.md).

## Endpoints

```http
GET    /v1/folders                    # List personal folders
POST   /v1/folders                    # Create folder
PATCH  /v1/folders/{id}               # Rename / update slug / description / readme
DELETE /v1/folders/{id}               # Delete folder (contents unfiled, subfolders promoted)
POST   /v1/artifacts/{id}/folder      # Move artifact into/out of a personal folder
```

All routes require authentication (Bearer token or session cookie).

## List folders

```http
GET /v1/folders
Authorization: Bearer {token}
```

**Response:**

```json
{
  "folders": [
    {
      "id": "fld_abc",
      "name": "Reports",
      "slug": "reports",
      "description": null,
      "created_at": "2026-06-17T10:00:00Z",
      "artifact_count": 3
    }
  ]
}
```

## Create folder

```http
POST /v1/folders
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Reports",
  "slug": "reports",
  "description": "Monthly exports",
  "parent_id": null,
  "readme": "# Reports\n\nMonthly exports for the leadership review. Keep charts SVG (Plotly), private."
}
```

- `slug` is optional (auto-generated from `name` if omitted).
- Slug format: lowercase alphanumeric + hyphens (`^[a-z0-9][a-z0-9-]*[a-z0-9]$`).
- Slugs are unique per owner among siblings (same `parent_id`).
- `parent_id`: optional — nest under another owned folder.
- `readme`: optional markdown **folder guide** — see below.

**Response (201):** folder object with `artifact_count: 0`.

## Folder guide (README) — the instruction surface for agents

A personal folder can carry a **guide**: a markdown `readme` describing what belongs in it and how to build for it (conventions, data sources, audience, rules). It shows at the top of the folder in the app and is meant for agents too.

**If you are an agent building or publishing into a folder, read its `readme` first and follow it** — treat it as the folder's local system prompt. Set or clear it with the `readme` field on create or `PATCH /v1/folders/{id}` (send `""` to clear). The folder's `readme` is returned in the home browser payload when you drill into the folder.

## Move artifact

```http
POST /v1/artifacts/{artifactId}/folder
Authorization: Bearer {token}
Content-Type: application/json

{ "folder_id": "fld_abc" }
```

Pass `"folder_id": null` to remove the artifact from its folder.

Only the artifact **owner** can move it. Folder assignment does not affect publish dedup — re-publishing matches on `display_slug` within the workspace/owner scope, not folder.

## Home UI

The home screen uses a **Personal vs Team** model. Use the **avatar switcher** (avatar menu) to move between **Personal** and each team workspace you belong to. Personal and Team Space each have their own folder chips in one unified top bar.

In the **All Artifacts** lens, click a folder to drill in (breadcrumb **All › {folder}**). Owners/admins can create, rename, or delete Team Space folders from that view; personal-folder owners can do the same on Personal home. Deleting a folder unfiles its pages — artifacts are not deleted.

On the personal home catalog (`GET /home`), the folders rail shows **"Private to you"**. Workspace catalogs switch to Team Space folders when a workspace is selected (labeled **"Team Space · {workspace name}"**).

## Related

- [artifacts.md](artifacts.md) — publish + slug dedup
- [../team/folders.md](../team/folders.md) — Team Space (workspace-shared) folders
