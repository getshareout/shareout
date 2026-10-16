---
title: Team Space folders
description: Organize workspace artifacts into shared folders visible to all workspace members.
---

import { Aside } from '@astrojs/starlight/components';

**Team Space folders** are shared folders inside a Teams workspace. Every
member can see and move artifacts into them. `owner` and `admin` create,
rename, and delete any folder. Members create folders and rename or delete the
ones they created, unless an admin turned **Members can create folders** off
(Admin → Settings, or `members_can_create_folders` on `PATCH /v1/workspaces/{id}`).

<Aside>
Personal folders (not tied to any workspace) use `/v1/folders`. This page
covers workspace folders only.
</Aside>

## Scopes

| Scope | Visible to | Folder creation | API prefix |
| --- | --- | --- | --- |
| Team Space | All workspace members | `owner` / `admin`; `member` unless turned off | `/v1/workspaces/{id}/folders` |
| Personal | Owner (+ linked accounts) | Owner | `/v1/folders` |

## Links and access

**Share a folder link.** Opening a folder on Home puts it in the address bar as
`#l/artifacts/<folderId>`, so a bookmark or a pasted link opens that folder with its
breadcrumbs, and back/forward work. **Copy link** in the folder header copies it.

**See who has access.** The folder header shows an access pill — **Private**,
**Workspace**, **Public** or **Shared externally** — with avatars of the people and
client orgs that have access through this folder or one above it. A folder set to
**Same as the parent folder** shows the access it inherits ("Inherited from …").

**Manage access.** Click the pill to open **Who has access**. A folder manager can:

- change **Visibility**: Same as the parent folder, Workspace, Public or Private;
- share with someone outside the workspace by email, at **View** or **Comment**, with an
  optional end date (7, 30 or 90 days, or a date);
- **Remove** a person;
- see **Who opened what** — what people outside the workspace opened, commented on or
  downloaded in this folder;
- **Copy client portal link**.

Folder managers are workspace owners and admins, plus the folder's creator while
**Members can create folders** is on. Everyone else sees the panel read-only. More in
[Client portals](/teams/client-portals/).

<Aside type="caution">
A folder's visibility is shown on the folder and drives the access pill. It does not
override the visibility of each artifact inside it; set that per artifact.
</Aside>

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
| `403 ADMIN_REQUIRED` | Member tried to create a folder while member folders are off, or to change one someone else created. |
| `409 SLUG_CONFLICT` | Slug already exists at this folder level. |
