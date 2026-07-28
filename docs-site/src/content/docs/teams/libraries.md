---
title: Workspace Library
description: Publish private, versioned JavaScript modules and import them into artifacts like a CDN library — scoped to your account or workspace.
---

import { Aside } from '@astrojs/starlight/components';

The **Workspace Library** lets a paid account publish private, versioned JavaScript
modules and import them into artifacts like a CDN library (e.g. plotly) — scoped to the
account or workspace. It's the reusable-**code** counterpart to the
[Skill Marketplace](/teams/skill-marketplace/), which shares reusable **prose** for the
agent.

<Aside type="note">
Requires a **Teams or Enterprise** plan to publish (gated on the publisher for personal
modules, on the workspace owner for workspace modules). In the app, open **Library** in
the Home left rail — Workspace and Personal tabs, plus **+ New module**.
</Aside>

## Two scopes

| Scope | Who can import | Serves at |
| --- | --- | --- |
| **Personal** | the owner's own artifacts | `/lib/@u/<user-handle>/<name>@<semver>.js` |
| **Workspace** | every workspace member's artifacts | `/lib/<workspace-slug>/<name>@<semver>.js` |

## What is a module?

A module is a `.js` file published with `artifact_type: "library"`. The README is the
entrypoint (rendered with copy-paste import snippets); the module JS serves at the
`/lib/...` URL. Modules are **pure** — data passed in as arguments, with no ambient SDK,
credentials, or network — so a module can't reach your data unless the host hands it in.
Module bytes are public by URL (like any CDN lib); privacy lives in the catalog.

## Publish

In the app: **Library → + New module** (name, version, scope, code, README).

Via API (`POST /v1/publish`):

```json
{
  "artifact_type": "library",
  "entrypoint": "README.md",
  "workspace_id": "wsp_…",
  "library": { "version": "1.0.0", "main": "index.js", "exports": ["bar"] },
  "files": [
    { "path": "README.md", "content": "# charts", "mime": "text/markdown" },
    { "path": "index.js", "content": "export const bar=(el,rows)=>{};", "mime": "text/javascript" }
  ]
}
```

Omit `workspace_id` for a personal module. Versions are **immutable** — re-publishing a
semver returns `409`. Bump the version to ship a change.

## Import & pin

```javascript
const { bar } = await so.lib('charts');   // pinned-or-latest for this artifact
```

An artifact can **pin** a module at a chosen version so it stays stable across
re-publishes:

| Method | Endpoint | Who |
| --- | --- | --- |
| `GET` | `/v1/artifacts/{id}/lib/{name}` | public — resolve to import URL |
| `GET` | `/v1/artifacts/{id}/libs` | viewer — list pins |
| `POST` | `/v1/artifacts/{id}/libs` | editor — pin `{ name, version? }` |
| `DELETE` | `/v1/artifacts/{id}/libs/{name}` | editor — unpin |

Catalog: `GET /v1/workspaces/{id}/libraries` (workspace) and `GET /v1/me/libraries`
(personal). See the [SDK reference](/sdk/libraries/) for `so.lib`.

## Not in v1

Bundling (TS/JSX/npm — pre-bundle and upload the output); modules that call the SDK;
private module bytes; semver ranges; eject-to-source.
