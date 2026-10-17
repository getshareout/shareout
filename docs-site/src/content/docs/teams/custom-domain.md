---
title: Custom domain
description: Serve a workspace on a hostname you own, like portal.acme.example.
---

A workspace can serve on your own hostname — `portal.acme.example` — instead of (or
besides) `{workspace}.{instance}`. Everything the workspace subdomain serves works there
too: the workspace home, artifacts, sign-in and the API. Once a custom domain is the
workspace's **primary** domain, share links, publish results and invitation emails use it.

Workspace `owner`s and `admin`s manage custom domains under **Admin → Custom domain**.

## Set it up

1. In **Admin → Custom domain**, type the hostname (for example `portal.acme.example`) and
   choose **Add domain**. It starts as *Waiting for DNS*.
2. At your DNS provider, add the records the page shows:

   | Type | Name | Value |
   | --- | --- | --- |
   | `CNAME` | `portal.acme.example` | the target shown on the page (for example `customers.{instance}`) |
   | `TXT` | the verification name shown (`_cf-custom-hostname.portal.acme.example`, or `_shareout-verify.portal.acme.example` on instances in manual mode) | the verification value shown |

   Use a subdomain (`portal.`, `docs.`, …). Most DNS providers do not allow a `CNAME`
   on a bare domain (`acme.example`).
3. Choose **Check again**. DNS changes usually show up within minutes; the HTTPS
   certificate is issued automatically. When the status reads **Live**, the hostname works.
4. Choose **Make primary** if links and emails should use it.

Until a hostname is **Live** it serves nothing — not the workspace, not anyone else's.

## Signing in on a custom domain

The custom domain keeps its own session. When someone signs in there, ShareOut sends
them through the instance's sign-in page and back with a one-time code that only works
on that hostname, for one minute, once. They sign in once per hostname.

## Rules

- A hostname belongs to one workspace. A **Live** hostname cannot be added by another
  workspace until its current workspace removes it.
- An unverified claim that never went live expires after 7 days, so nobody can block a
  hostname they do not control.
- **Remove** takes the hostname off immediately; links on it stop working.
- Up to 10 custom domains per workspace.

## API

```http
GET    /v1/workspaces/{workspaceId}/domains            # ?refresh=1 re-checks pending ones
POST   /v1/workspaces/{workspaceId}/domains            { "hostname": "portal.acme.example" }
POST   /v1/workspaces/{workspaceId}/domains/{id}/refresh
PATCH  /v1/workspaces/{workspaceId}/domains/{id}       { "primary": true }
DELETE /v1/workspaces/{workspaceId}/domains/{id}
```

Each domain carries `status` (`pending`, `active`, `failed`), `is_primary`, the `dns`
records to add and plain-language `instructions`.

## For instance operators

Custom domains are off until you turn them on:

- **Cloudflare for SaaS** (certificates and verification handled by Cloudflare): set the
  secret `CF_CUSTOM_HOSTNAMES_TOKEN` (Zone → SSL and Certificates: Edit), the var
  `CF_CUSTOM_HOSTNAMES_ZONE_ID`, and `CUSTOM_DOMAINS_CNAME_TARGET` (the hostname customers
  CNAME to). Enable Cloudflare for SaaS on the zone, create the fallback origin and route
  `*/*` to the Worker — see Cloudflare's
  [getting started](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/)
  and [Workers as your fallback origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/).
- **Manual mode** (no Cloudflare credentials): set only `CUSTOM_DOMAINS_CNAME_TARGET`.
  ShareOut verifies ownership with the `_shareout-verify` TXT record; you route each
  verified hostname to the Worker yourself (a Workers custom domain or route).
