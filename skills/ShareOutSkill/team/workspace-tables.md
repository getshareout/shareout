# Workspace Shared Tables

Workspace shared tables let one artifact expose a table to **every artifact in the same workspace** — so a form collects data in one artifact and a dashboard reads it in another. The table stays **owned by, and stored in, the artifact that created it**; sharing is an opt-in grant, not a copy.

Load [SKILL.md](SKILL.md) first. For the base (artifact-private) table API, read [../sdk/table.md](../sdk/table.md) — the shared API mirrors it exactly.

## Mental Model

| | Private table | Shared table |
| --- | --- | --- |
| SDK | `so.table('leads')` | `so.workspace.table('leads')` |
| Visible to | Only this artifact | Every artifact in the workspace |
| Stored in | This artifact's mini-store | The **owner** artifact's mini-store (unchanged) |
| Default | — | **Private** until the owner shares it |
| Who can write | This artifact | Owner always; others only if shared **read/write** |

A table is **private by default**, even inside a workspace. Nothing is shared until the owning artifact opts in. Sharing is reversible — unshare and the table is invisible to the workspace again.

## Access Levels

| Access | Other artifacts can read | Other artifacts can write | Use for |
| --- | --- | --- | --- |
| `read` (default) | ✓ | | A form/intake artifact owns the data; dashboards read it |
| `readwrite` | ✓ | ✓ | A shared pool several artifacts contribute to (e.g. `tasks`) |

The **owner artifact always has full read/write** to its own table — the access level only governs what *other* artifacts get.

## Share A Table (owner action)

Only the **artifact owner** can share one of its tables. The shared name is unique per workspace (defaults to the table name; pick another with `as` if it collides).

```js
const so = await ShareOut.create();

// Expose this artifact's "leads" table to the workspace, read-only.
await so.workspace.shareTable('leads', { access: 'read' });

// Or share under a different workspace-wide name, read/write.
await so.workspace.shareTable('tasks', { as: 'team_tasks', access: 'readwrite' });
```

REST equivalent (owner token):

```http
POST /v1/data/{artifactId}/workspace/_share
Authorization: Bearer {token}
Content-Type: application/json

{ "table": "leads", "as": "leads", "access": "read" }
```

Stop sharing:

```js
await so.workspace.unshareTable('leads');
```

## Read / Write A Shared Table (any member artifact)

Any artifact in the same workspace reaches a shared table by its shared name. Same methods as `so.table()` — `insert`, `find`, `findOne`, `update`, `count`, `distinct`:

```js
const so = await ShareOut.create();
const leads = so.workspace.table('leads');

// Read (allowed for read and readwrite grants)
const recent = await leads.find({ status: 'new' }).sort('createdAt', 'desc').limit(20).exec();
const total  = await leads.count();

// Write (only when the owner shared it as readwrite; otherwise 403 FORBIDDEN)
await leads.insert({ name: 'Ana', email: 'ana@example.com', status: 'new' });
```

Writing to a `read`-only shared table returns `403 FORBIDDEN`. Writes land in the **owner artifact's** store, exactly as if the owner wrote them.

## Discover What's Shared

List every table shared into the workspace (any member):

```http
GET /v1/workspaces/{workspaceId}/shared-tables
Authorization: Bearer {token}
```

```json
{
  "viewerRole": "member",
  "sharedTables": [
    { "sharedName": "leads", "access": "read", "ownerArtifactId": "art_…", "ownerName": "Lead Form", "ownerSlug": "lead-form", "sourceTable": "leads" }
  ]
}
```

In the workspace **Home**, members see these under the **Datasets** tab in the sidebar.

## Roles

| Action | Owner of the source artifact | Other workspace member |
| --- | --- | --- |
| Share / unshare a table | ✓ (its own tables) | |
| Read a shared table from an artifact | ✓ | ✓ |
| Write a `readwrite` shared table from an artifact | ✓ | ✓ |
| List the workspace's shared tables | ✓ | ✓ |

## Limits & Notes

- **Workspace required.** Personal artifacts (no workspace) cannot share or read shared tables — the call returns `403`.
- **Row-level access policy is not applied** to a shared table: it is exposed to the workspace as a unit, not filtered per viewer. Don't share a table whose rows are meant to be viewer-scoped.
- **Same-workspace only.** Artifacts in other workspaces never see a workspace's shared tables.
