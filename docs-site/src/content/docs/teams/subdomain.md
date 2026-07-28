---
title: Custom subdomains
description: Serve a Teams workspace at {workspace}.shareout.site.
---

Teams workspaces can serve artifacts at `{workspace}.shareout.site` — a
branded home that keeps all workspace URLs under one host.

## Routing

| URL | Serves |
| --- | --- |
| `{workspace}.shareout.site/` | Workspace landing / gallery. |
| `{workspace}.shareout.site/{artifact-slug}` | Artifact in the workspace. |
| `{workspace}.shareout.site/{folder}/{artifact-slug}` | Artifact inside a folder. |

Workspace artifacts are also reachable at `shareout.site/@{workspace}/{artifact}`.

## Full product mirror

A subdomain is not just a public gallery — it is a **full mirror** of the apex app for
that workspace. These paths pass through unchanged so members can sign in, open Home,
edit artifacts, and call APIs from the branded host:

`/v1/`, `/auth/`, `/sdk/`, `/embed/`, `/t/`, `/a/`, `/p/`, `/@`, `/brand/`, `/wl/`,
`/settings/`, `/app/`, `/home`, `/create`

That means `{workspace}.shareout.site/app/…` serves the same Home and studio surfaces as
`shareout.site/app/…`, scoped to the workspace context. Use relative links inside
artifacts and product UI so pages work on both hosts.

## Enable

Requires Teams plan and workspace `admin` or `owner`.

```http
POST /v1/workspaces/{workspaceId}/subdomain
Authorization: Bearer {token}
Content-Type: application/json

{ "enabled": true }
```

```json
{
  "success": true,
  "subdomain": "acme.shareout.site",
  "workspace_slug": "acme",
  "enabled": true
}
```

## Disable

```http
DELETE /v1/workspaces/{workspaceId}/subdomain
Authorization: Bearer {token}
```

## Check status

```http
GET /v1/workspaces/{workspaceId}/subdomain
Authorization: Bearer {token}
```

## Reserved slugs

These workspace slugs are reserved and cannot be used as subdomain names:
`www`, `api`, `app`, `admin`, `cdn`, `static`, `mail`, `assets`, `support`,
`help`, `status`.

## SDK links inside artifacts

Use relative links inside artifact HTML when the artifact should work on both
the subdomain URL and the canonical `shareout.site/@{workspace}/…` URL. Do
not hardcode the subdomain hostname.
