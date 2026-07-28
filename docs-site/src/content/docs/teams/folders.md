---
title: Team Space folders
description: Organize workspace artifacts into shared folders visible to all workspace members.
---

import { Aside } from '@astrojs/starlight/components';

**Team Space folders** are shared folders inside a Teams workspace. Every
member can see and move artifacts into them; only `owner` and `admin` can
create, rename, or delete folders.

<Aside>
Personal folders (not tied to any workspace) use `/v1/folders`. This page
covers workspace folders only.
</Aside>

## Scopes

| Scope | Visible to | Folder creation | API prefix |
| --- | --- | --- | --- |
| Team Space | All workspace members | `owner` / `admin` only | `/v1/workspaces/{id}/folders` |
| Personal | Owner (+ linked accounts) | Owner | `/v1/folders` |

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

All routes require workspace membership. Create, patch, and delete require
`owner` or `admin`.

## List folders

```http
GET /v1/workspaces/{workspaceId}/folders?parent_id={folderId}
Authorization: Bearer {token}
```

Omit `parent_id` for top-level folders. Each item includes `artifact_count`,
`subfolder_count`, `visibility`, and `parent_id`.

## Create a folder

```http
POST /v1/workspaces/{workspaceId}/folders
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Q1 Reports",
  "slug": "q1-reports",
  "description": "Quarterly dashboards",
  "parent_id": null,
  "visibility": "inherit"
}
```

`visibility` options:

| Value | Effect |
| --- | --- |
| `inherit` | Artifacts inherit the folder's workspace visibility. Default. |
| `private` | Only explicit collaborators. |
| `workspace` | All workspace members. |
| `public` | Open web access. |

Slugs are unique per parent level within the workspace.

## Move an artifact into a folder

Any workspace member can file a workspace artifact:

```http
POST /v1/workspaces/{workspaceId}/artifacts/{artifactId}/move
Authorization: Bearer {token}
Content-Type: application/json

{ "folder_id": "fld_abc" }
```

Pass `"folder_id": null` to remove from any folder.

## URLs

Folder slugs appear in subdomain and namespaced URLs:

| Pattern | Example |
| --- | --- |
| `{ws}.shareout.site/{folder}/{artifact-slug}` | `acme.shareout.site/q1-reports/sales-dashboard` |
| `shareout.site/@{ws}/{folder}/{artifact-slug}` | `shareout.site/@acme/q1-reports/sales-dashboard` |

The slug in these URLs is the artifact's human slug (`display_slug`), unique
per workspace.

## Errors

| Code | Meaning |
| --- | --- |
| `403 ADMIN_REQUIRED` | Member tried to create/delete a folder. |
| `409 SLUG_CONFLICT` | Slug already exists at this folder level. |
