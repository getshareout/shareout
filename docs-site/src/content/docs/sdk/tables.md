---
title: Tables (Tier 2)
description: Structured records with filtering, sorting, and pagination.
---

import { Aside } from '@astrojs/starlight/components';

Structured records — tasks, leads, entries — with a query builder. Access via
`sdk.table(name)`.

## Methods

```typescript
insert(doc): Promise<T>
insertMany(docs): Promise<T[]>
findById(id): Promise<T | null>
findOne(filter): Promise<T | null>
find(filter?): Query<T>          // chainable
updateById(id, changes): Promise<T | null>
update(filter, changes): Promise<{ updated: number }>
deleteById(id): Promise<boolean>
delete(filter): Promise<{ deleted: number }>
count(filter?): Promise<number>
distinct(field, filter?): Promise<value[]>
```

## Query builder

```typescript
find(filter).filter(f).sort(field, 'asc' | 'desc').limit(n).skip(n).select(fields).exec()
```

**Filter operators:** `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` `$in` `$nin`
`$contains` `$startsWith` `$endsWith`.

## Examples

```javascript
const tasks = sdk.table('tasks');

await tasks.insert({ title: 'Build', status: 'pending', priority: 1 });

const urgent = await tasks
  .find({ status: { $in: ['pending', 'active'] }, priority: { $lte: 2 } })
  .sort('priority', 'asc')
  .limit(10)
  .exec();

const pending = await tasks.count({ status: 'pending' });
const statuses = await tasks.distinct('status');
```

## Manifest

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "tables": {
      "tasks": {
        "schema": [
          { "name": "id", "type": "string", "primary": true },
          { "name": "title", "type": "string" },
          { "name": "status", "type": "string" },
          { "name": "priority", "type": "number" }
        ]
      }
    }
  }
}
</script>
```

<Aside type="caution" title="Per-viewer isolation is server-side">
To show each customer only their own rows (multi-tenant dashboards), use an
**access policy** set at publish time. Client-side `find()` filters do **not**
secure data — the page source is visible to viewers. Filtering must be enforced
server-side from the signed-in viewer's identity.
</Aside>

## Write roles (manifest)

Per-table `write` in the manifest restricts who can **mutate** rows (`insert` /
`update` / `delete`). Values: `"any"` (default), `"collaborator"`, or `"owner"`.
Violations return `403 TABLE_WRITE_FORBIDDEN`. See [Manifest → tables](/spec/manifest/#sourcestables).

## Share a table across artifacts (Teams)

By default a table is **private to its artifact** — no other page can see it. On a
Teams workspace, the owning artifact can **share** a table so other artifacts in the
same workspace read (and optionally write) it. One page collects, another displays.

The table stays owned by, and stored in, the artifact that created it. Sharing is an
opt-in grant, reversible at any time.

```javascript
// Owner artifact (e.g. a lead-capture form) — share its own "leads" table.
await sdk.workspace.shareTable('leads', { access: 'read' });      // others read only
await sdk.workspace.shareTable('tasks', { access: 'readwrite' }); // others read + write

// Any other artifact in the same workspace — same Table API, via .workspace.
const leads = sdk.workspace.table('leads');
const recent = await leads.find({ status: 'new' }).sort('createdAt', 'desc').exec();
await leads.insert({ name: 'Ana' });   // throws FORBIDDEN unless shared 'readwrite'

// Discover what's shared, and stop sharing.
const shares = await sdk.workspace.listShares();
await sdk.workspace.unshareTable('leads');
```

`sdk.workspace.table(name)` exposes the **same methods** as `sdk.table(name)` —
`find`, `insert`, `update`, `count`, `distinct`, and the query builder.

| Access | Other artifacts read | Other artifacts write |
| --- | --- | --- |
| `read` (default) | ✓ | |
| `readwrite` | ✓ | ✓ |

<Aside type="note">
Only the artifact **owner** can share its tables, and only within a **workspace**
(personal artifacts can't share). Shared tables are exposed to the workspace as a
unit — they are **not** row-filtered per viewer, so don't share a table whose rows
are meant to be viewer-scoped. Workspace members see what's shared under the
**Datasets** tab in their workspace home.
</Aside>

## Performance

- Fetch once at app root; pass data down as props.
- Paginate large sets with `.limit(50)`.
- After mutations, `sdk.invalidateTableCache('tasks')`.
