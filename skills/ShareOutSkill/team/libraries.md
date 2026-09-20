# Workspace Library

The **Workspace Library** lets an account publish private, versioned JavaScript
modules and import them into artifacts like a CDN library (e.g. plotly) — but scoped to
the account or workspace. It is the reusable-code counterpart to the
[Skill Marketplace](skill-marketplace.md) (which shares *prose* for the agent); the
library shares *runnable code* for artifacts.

Load [SKILL.md](SKILL.md) first.

## Availability

No tier requirement — publishing a module goes through the normal publish path, gated
on ownership (the publisher for personal modules, the workspace owner/role for workspace
modules), same as any other artifact publish. In Home, open the **Library** lens
(Workspace and Personal tabs, plus **+ New module**).

## Two scopes

| Scope | Who can import | Serves at |
| --- | --- | --- |
| **Personal** | the owner's own artifacts | `/lib/@u/<user-handle>/<name>@<semver>.js` |
| **Workspace** | every workspace member's artifacts | `/lib/<workspace-slug>/<name>@<semver>.js` |

Module bytes are public by URL (like any CDN lib); modules are **pure** (no secrets/data
inside — see below), so privacy lives in the catalog, not the bytes.

## What is a module?

A module is a `.js` file published with `artifact_type: "library"`. The README is the
artifact entrypoint (rendered in a library viewer with copy-paste import snippets); the
module JS rides as a version asset and is served at the `/lib/...` URL.

Modules are **pure** in v1: data is passed in as arguments, with **no ambient SDK,
credentials, or network**. Safe by construction — a module can't reach `so.table` or
secrets unless the host artifact hands it the data.

## Publish

Token API (`POST /v1/publish`):

```json
{
  "artifact_type": "library",
  "entrypoint": "README.md",
  "workspace_id": "wsp_…",            // omit for a personal module
  "library": { "version": "1.0.0", "main": "index.js", "exports": ["bar"] },
  "files": [
    { "path": "README.md", "content": "# charts\n\nUsage.", "mime": "text/markdown" },
    { "path": "index.js", "content": "export const bar=(el,rows)=>{};", "mime": "text/javascript" }
  ]
}
```

In-app form (session): **Library → + New module** posts to `POST /v1/me/libraries`
(`{ name, version, scope, workspace_id?, main, exports, js, readme }`).

Versions are **immutable** — re-publishing a published semver returns `409
LIBRARY_VERSION_EXISTS`. Bump the version to ship a change.

## Import

```javascript
// SDK — resolves the pinned-or-latest version for this artifact's scope.
const { bar } = await so.lib('charts');

// Plain HTML — import the versioned URL directly (same-origin, immutable).
// <script type="module"> import { bar } from "/lib/<slug>/charts@1.0.0.js"; </script>
```

See [../sdk/libraries.md](../sdk/libraries.md) for the SDK method.

## Pin a version

By default `so.lib` follows a module's latest version. Pin a module on a consuming
artifact to lock it to a chosen version (stable across re-publishes):

| Method | Endpoint | Who |
| --- | --- | --- |
| `GET` | `/v1/artifacts/{id}/lib/{name}` | public | Resolve name → pinned-or-latest import URL. |
| `GET` | `/v1/artifacts/{id}/libs` | `viewer`+ | List the artifact's pins. |
| `POST` | `/v1/artifacts/{id}/libs` | `editor`+ | Pin `{ name, version? }` (defaults to latest). |
| `DELETE` | `/v1/artifacts/{id}/libs/{name}` | `editor`+ | Remove a pin. |

## Catalog

| Method | Endpoint | Who |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/libraries` | Member | Workspace modules. |
| `GET` | `/v1/me/libraries` | Owner | Personal modules. |
| `POST` | `/v1/me/libraries` | Owner | Publish a module from the app (both scopes via body). |

Full REST table: [api.md](api.md#workspace-library). The agent building an artifact is
shown the API surface (names, versions, exports) of modules it may import.

## Public npm libraries: `/vendor/`

The Workspace Library is for **your own** code. Public npm libraries (Plotly, D3,
Chart.js…) are served by the instance itself at
`/vendor/<npm package>@<version>/<file>` — same bytes as jsDelivr, fetched once, stored
by the instance and served immutable + edge-cached from a host the viewer is already
connected to. Publishing rewrites `cdn.plot.ly`, `d3js.org`, `cdn.jsdelivr.net/npm/…`
and `unpkg.com/…` URLs to it automatically.

Which packages an instance will vendor has three layers:

| Layer | Who sets it | How |
| --- | --- | --- |
| Built-in set | ShareOut | ~26 curated packages, shipped with the product |
| Instance-wide | The operator of this Cloudflare instance | `VENDOR_PACKAGES_EXTRA="highcharts,vis-network"`, or `VENDOR_ALLOW_ANY=1` to drop the list entirely |
| Per workspace | A workspace **admin or owner** | the API below — no env change, no deploy |

| Method | Endpoint | Who | |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/vendor-packages` | Member | Built-ins + instance extras + this workspace's packages. |
| `POST` | `/v1/workspaces/{id}/vendor-packages` | `admin`+ | Register `{ "package": "highcharts" }`. |
| `DELETE` | `/v1/workspaces/{id}/vendor-packages/{package}` | `admin`+ | Stop rewriting it. Already-published artifacts keep working. |

Two things worth knowing:

- **Serving is instance-wide.** `/vendor` resolves before any artifact or workspace is
  known, so a package one workspace registers is servable by the whole instance. The
  bytes are public npm code, not workspace data; what the workspace scope controls is
  whose artifacts get their URLs rewritten, and who may manage the row.
- **Removing a package does not break what is already published.** The stored bytes
  stay; removal only stops future rewrites.

## Deferred (not in v1)

Bundling (TS/JSX/npm-import — pre-bundle and upload the output instead); modules that
call the SDK; private (non-public) module bytes; semver ranges / lockfile; eject-to-source.
