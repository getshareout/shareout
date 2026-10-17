# REST API: Artifact templates

Save an artifact — or a folder of artifacts — as a **template**, and install it in any
workspace the template reaches, in one call. (`/v1/templates` is the separate
[email-template API](templates.md).)

A template is a scrubbed, versioned snapshot:

| Carried | Never carried |
|---|---|
| Files of the live version (every page of a multi-page artifact, CSS, JS, images) | Table rows, dataset contents, SDK store values |
| Type metadata, folder tree and folder guides | Connector config and credentials |
| Table and dataset **schemas** (columns); optionally ≤ 5 sample rows | Comments, analytics, Knowledge |
| Connector **names + provider** → "connect your X" setup steps | Credentials in the code (`so_…`, `sk-…`, `Bearer …`, keys) — redacted |
| Comments and viewer config (`_comments_config`, `_viewer_config`) | Links to pages that are not in the template (→ `#`) |

Links between pages of the template (`/a/<slug>`, `/@<workspace>/<path>`, the workspace
subdomain form) are rewritten to the new slugs on install.

## Scopes

| `scope` | Who can install it |
|---|---|
| `private` (default) | Its home workspace. Saved from a personal space: only its creator, there |
| `shared` | Private plus `shared_workspace_ids` (you must belong to each, unless instance admin) |
| `instance` | Every workspace on the instance — **instance admins only** |

A template outside your reach answers `404`, the same as a missing one.

## Endpoints

```http
GET    /v1/artifact-templates?workspace=<id>&q=&tag=     # list installable here
POST   /v1/artifact-templates/preview                    # what goes in / stays behind
POST   /v1/artifact-templates                            # save (artifact_id | folder_id)
GET    /v1/artifact-templates/{id}                       # detail, schemas, versions
PATCH  /v1/artifact-templates/{id}                       # name, description, tags, scope, shares, preview_image
DELETE /v1/artifact-templates/{id}                       # installed copies stay
POST   /v1/artifact-templates/{id}/versions              # new version from the source
POST   /v1/artifact-templates/{id}/install               # { workspace_id, folder_id? }
GET    /v1/artifact-templates/installed?artifact_id=     # update available?
POST   /v1/artifact-templates/installed/update           # { artifact_id, confirm? }
```

## Save

```bash
curl -X POST "$ORIGIN/v1/artifact-templates" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"folder_id":"fld_…","name":"Client onboarding kit","tags":["onboarding"],"version":"1.0.0"}'
```

You must be able to edit the artifact (for a folder: each artifact you can't edit is
skipped and listed). If the content looks personal or workspace-specific — emails, phone
numbers, the workspace's name, its members, internal ids — the answer is `409
REVIEW_REQUIRED` with `findings` (masked samples) and `preview`. **Show the findings to
the person.** Save again with `"acknowledge_findings": true` only if they confirm;
otherwise edit the page first. These are heuristics, not a guarantee.

## Install

```bash
curl -X POST "$ORIGIN/v1/artifact-templates/tpl_…/install" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"workspace_id":"wsp_…","folder_id":"fld_…"}'
```

```json
{
  "install_group": "tig_…",
  "folder_id": "fld_…",
  "artifacts": [{ "key": "a1", "artifact_id": "art_…", "slug": "sales-hub-2", "url": "…/a/sales-hub-2/" }],
  "setup": [
    { "step": { "kind": "connector", "name": "crm", "provider": "postgres", "items": ["a1"] }, "done": false },
    { "step": { "kind": "table", "name": "deals", "columns": ["client", "amount"], "item": "a1" }, "done": false }
  ]
}
```

Every install creates new artifacts (never overwrites one), in the target folder; a
folder template recreates its folder tree there. Tell the person each setup step: a
connector is set up under the workspace's data sources with the **same name**.

## Versions and updates

`POST /{id}/versions` snapshots the source again (`version` defaults to the next minor).
Installed copies then report `update_available` on `GET /installed?artifact_id=`.
`POST /installed/update` without `confirm` returns the plan (files that change per
page); with `"confirm": true` every page of that install gets a **new version**
(`source: "template"`) — earlier versions stay in History, data is not touched, and new
tables/datasets are created empty. Requires edit access to every page of the install.

## MCP

`list_templates`, `install_template`, `save_as_template` — see
[integrations/mcp-connector.md](../integrations/mcp-connector.md).

## Provisioning

Server code that creates workspaces calls `installTemplateSet(env, actor, { workspaceId,
templateIds?, tag? })` (`src/templates`) to seed them; only templates whose scope reaches
the new workspace are installed.
