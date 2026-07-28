---
title: Your data is portable
description: Everything you create on ShareOut is exportable — no proprietary formats, no exit fees, no dark patterns.
---

Your data is yours. Everything you create on ShareOut is exportable — no
proprietary formats, no exit fees, no dark patterns. We keep customers by
being good, not by locking doors.

## Artifacts are just HTML

A ShareOut artifact is a standard, self-contained HTML page — not a proprietary
render format. Fetch the page and you have the source:

```bash
curl https://shareout.site/a/{slug}/
```

There's no compiled bundle you can't read and no ShareOut-only markup you can't
take elsewhere. Drop the HTML into any static host and it still works, minus
the ShareOut-hosted data layer.

## Your data lives behind documented REST APIs

Everything an artifact stores — JSON, table rows, blobs — is reachable through
the same [`/v1/data`](/guides/data/) API your artifact itself uses. Nothing is
locked in an internal format only ShareOut's UI can read:

```bash
curl https://shareout.site/v1/data/{artifact_id}/json/{key} \
  -H "Authorization: Bearer $TOKEN"
curl https://shareout.site/v1/data/{artifact_id}/tables/{table}/query \
  -H "Authorization: Bearer $TOKEN"
```

See the [Storing data guide](/guides/data/) and [SDK overview](/sdk/overview/)
for the full read surface — json, tables, blobs, and beyond.

## One-click export

Export from the artifact card menu (↓ **Export** icon) or the API — downloads a
zip of the published HTML source plus all its data (json keys, table CSVs, blobs)
with a `manifest.json`. No API scripting required.

| Endpoint | Who | Contents |
| --- | --- | --- |
| `GET /v1/artifacts/{id}/export` | Owner or workspace admin | One artifact |
| `GET /v1/workspaces/{id}/export` | Workspace owner or admin | All artifacts (cap **200** per zip) |

Zip layout per artifact: `source/` (published files), `data/json/*.json`,
`data/tables/{table}.csv`, and `manifest.json` (name, slug, version).

## Custom subdomains and domains move with you

- **Teams**: a custom subdomain (`yourteam.shareout.site`) — see [Custom subdomain](/teams/subdomain/).
- **Enterprise**: a custom domain you control, so your URLs don't have to change
  even if your relationship with ShareOut does.

## Deleting your account or workspace

Deleting an artifact, workspace, or account removes its content. Artifacts have
a 30-day recovery window before permanent purge — see
[Publishing artifacts → Deleting & restoring](/guides/publishing/#deleting--restoring).
For DPA requests or other data-handling questions, contact
[security@shareout.site](mailto:security@shareout.site). The public
[Security & Trust](https://shareout.site/security) page lists subprocessors,
encryption practices, and moderation details.
