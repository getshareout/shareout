# SDK: Tables (Tier 2)

Structured records with filtering, sorting, pagination. Access via `sdk.table(name)`.

> **Per-viewer data isolation:** to share one table across multiple external customers where each sees only their own rows (multi-tenant dashboards, per-customer reports), see [core/access-policy.md](../core/access-policy.md). Filtering is enforced **server-side** from the signed-in viewer's identity — client-side `find()` filters do **not** secure data, since the page source is visible to viewers.

> **Who may write rows:** set `sources.tables.<name>.write` in the [manifest](../core/html-spec/manifest.md) to `"owner"`, `"collaborator"`, or `"any"` (default). Restricted tables return `403 TABLE_WRITE_FORBIDDEN` for unauthorized mutators — do not rely on hiding buttons in the page.

> **Share a table across artifacts (Teams):** to let *another artifact* in the same workspace read/write this table (one page collects, another displays), use `sdk.workspace.table(name)` — see [team/workspace-tables.md](../team/workspace-tables.md).

## Table Methods

```typescript
// Insert single row
insert(doc: Omit<T, 'id'>): Promise<T>

// Insert multiple rows
insertMany(docs: Omit<T, 'id'>[]): Promise<T[]>

// Get by ID
findById(id: string): Promise<T | null>

// Find single match
findOne(filter: Filter<T>): Promise<T | null>

// Query builder
find(filter?: Filter<T>): Query<T>

// Update by ID
updateById(id: string, changes: Partial<T>): Promise<T | null>

// Update by filter
update(filter: Filter<T>, changes: Partial<T>): Promise<{ updated: number }>

// Delete by ID
deleteById(id: string): Promise<boolean>

// Delete by filter
delete(filter: Filter<T>): Promise<{ deleted: number }>

// Count matching rows
count(filter?: Filter<T>): Promise<number>

// Distinct values for field
distinct<K extends keyof T>(field: K, filter?: Filter<T>): Promise<T[K][]>
```

## Query Builder

```typescript
find(filter?: Filter<T>): Query<T>

// Chain methods
query.filter(filter: Filter<T>): Query<T>
query.sort(field: keyof T, order: 'asc' | 'desc'): Query<T>
query.limit(n: number): Query<T>
query.skip(n: number): Query<T>
query.select(fields: (keyof T)[]): Query<T>
query.exec(): Promise<T[]>
```

## Filter Operators

```typescript
type FilterOperator<T> = {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $in?: T[];
  $nin?: T[];
  $contains?: string;
  $startsWith?: string;
  $endsWith?: string;
};
```

## Examples

```javascript
const tasks = sdk.table('tasks');

// Insert
const task = await tasks.insert({ title: 'Build', status: 'pending', priority: 1 });

// Query with operators
const urgent = await tasks.find({
  status: { $in: ['pending', 'active'] },
  priority: { $lte: 2 }
}).sort('priority', 'asc').limit(10).exec();

// Pagination
const page2 = await tasks.find({})
  .sort('createdAt', 'desc')
  .skip(20)
  .limit(10)
  .exec();

// Aggregations
const pendingCount = await tasks.count({ status: 'pending' });
const allStatuses = await tasks.distinct('status');
```

## Manifest Declaration

Declare each table's schema in your manifest (see [overview.md](overview.md#manifest-declaration)):

```json
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
```

## Performance Tips

1. **Fetch once at app root** - Prevents refetching on navigation
2. **Use empty dependency array** - `useEffect(() => {...}, [])`
3. **Pass data as props** - Tabs/views share same data
4. **Invalidate after mutations** - `sdk.invalidateTableCache('tasks')`
5. **Paginate large datasets** - Use `.limit(50)` for 1000+ rows

## Related

- [JSON Store](json.md) - For simple key-value
- [Realtime](realtime.md) - For live collaboration
- [Manifest](../core/html-spec/manifest.md) - Declaring schemas
