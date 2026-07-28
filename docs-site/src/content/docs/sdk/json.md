---
title: JSON store (Tier 1)
description: Key-value storage for simple artifact state, with atomic updates.
---

Key-value storage for simple state — preferences, flags, counters, cached values.
Access via `sdk.json`.

## Methods

```typescript
get<T>(key: string): Promise<T | null>
getEntry<T>(key: string): Promise<{ key: string; value: T; updatedAt: string } | null>
set<T>(key: string, value: T, options?: {
  ifMatch?: string;      // only write if current updatedAt matches
  ifNoneMatch?: '*';    // only create if key is absent
}): Promise<{ key: string; created: boolean; updatedAt: string }>
update<T>(key: string, fn: (prev: T | null) => T, options?: {
  retries?: number;      // default 8
}): Promise<T>
delete(key: string): Promise<boolean>
exists(key: string): Promise<boolean>
list(): Promise<string[]>
clear(): Promise<void>
```

## Examples

```javascript
await sdk.json.set('prefs', { theme: 'dark', fontSize: 14 });
const prefs = await sdk.json.get('prefs');

// Atomic increment — safe under concurrent viewers/editors
const next = await sdk.json.update('counter', n => (n || 0) + 1);

// Manual compare-and-swap
const entry = await sdk.json.getEntry('prefs');
if (entry) {
  await sdk.json.set('prefs', { ...entry.value, theme: 'light' }, {
    ifMatch: entry.updatedAt,
  });
}

const keys = await sdk.json.list();
```

## Atomic `update()`

`update()` does a **read → transform → conditional write** loop:

1. `getEntry` reads the current value and `updatedAt` version token
2. Your function computes the next value
3. `set` sends `If-Match: <updatedAt>` (or `If-None-Match: *` for first create)
4. On `409 VERSION_CONFLICT`, it re-reads and retries (default 8 times)

Use this for counters, toggles, and any read-modify-write. A plain
`get` + `set` can lose updates under concurrent writers.

REST equivalents:

| Header | Meaning |
| --- | --- |
| `If-Match: <updatedAt>` | Update only if the stored version matches |
| `If-None-Match: *` | Create only if the key does not exist |

Mismatch → `409 VERSION_CONFLICT`.

## Manifest

Declare every key you use:

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "json": {
      "prefs": { "default": { "theme": "light" } },
      "counter": { "default": 0 }
    }
  }
}
</script>
```

Reach for [tables](/sdk/tables/) when you need many structured records with
filtering instead of a single value.
