# SDK: JSON Store (Tier 1)

Key-value storage for simple state. Access via `sdk.json`.

## Methods

```typescript
// Get value (returns null if not found)
get<T>(key: string): Promise<T | null>

// Set value
set<T>(key: string, value: T): Promise<void>

// Delete key (returns true if existed)
delete(key: string): Promise<boolean>

// List all keys
list(): Promise<string[]>

// Update with function
update<T>(key: string, fn: (prev: T | null) => T): Promise<T>

// Check if key exists
exists(key: string): Promise<boolean>

// Clear all keys
clear(): Promise<void>
```

## Examples

```javascript
// Simple value
await sdk.json.set('counter', 42);
const count = await sdk.json.get('counter'); // 42

// Object value
await sdk.json.set('prefs', { theme: 'dark', fontSize: 14 });
const prefs = await sdk.json.get('prefs');

// Read-modify-write update (NOT atomic — last write wins on concurrent callers)
const newCount = await sdk.json.update('counter', n => (n || 0) + 1);

// Check existence
if (await sdk.json.exists('prefs')) {
  // ...
}

// List and iterate
const keys = await sdk.json.list();
for (const key of keys) {
  const value = await sdk.json.get(key);
}
```

## Manifest Declaration

Declare every JSON key in your manifest (see [overview.md](overview.md#manifest-declaration)):

```json
"json": {
  "settings": { "default": { "theme": "light" } },
  "counter": { "default": 0 }
}
```

## Use Cases

| Use Case | Example |
|----------|---------|
| User preferences | Theme, language, layout |
| Simple state | Last opened, filters |
| Cached data | API responses |
| Flags | Feature toggles |

## Related

- [Tables](table.md) - For structured records
- [Manifest](../core/html-spec/manifest.md) - Declaring sources
