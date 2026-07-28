# Shared: Version History

Common versioning model used across all ShareOut modules.

## Version Types

| Type | Trigger | Retention | Restore |
|------|---------|-----------|---------|
| **Auto-save** | Every 5 minutes | 24 hours | ✓ |
| **Named version** | Manual | Forever | ✓ |
| **Published** | Publish action | Forever | ✓ |

## Creating Named Versions

```javascript
// Create named version
await module.versions.create('v1.0 - Launch ready');

// List all versions
const versions = await module.versions.list();
// [
//   { id: 'v_abc', name: 'v1.0 - Launch ready', created_at: '...', type: 'named' },
//   { id: 'v_def', name: null, created_at: '...', type: 'autosave' },
// ]
```

## Restoring Versions

```javascript
// Preview before restore
const preview = await module.versions.preview('v_abc');

// Restore (creates new version from old state)
await module.versions.restore('v_abc');
```

## Comparing Versions

```javascript
// Get diff between versions
const diff = await module.versions.diff('v_abc', 'v_def');
// { added: [...], removed: [...], modified: [...] }
```

## Auto-Save Behavior

- Saves every 5 minutes during active editing
- Creates checkpoint before major operations
- Auto-saves kept for 24 hours
- Named versions never expire

## Module-Specific Notes

### Slides
- Per-slide diff available
- Restore single slides or entire deck

### Dashboards
- Widget-level diff
- Data snapshots optional

### Mobile
- PWA cache versioning
- Offline queue preserved

## Related

- [Permissions](permissions.md) - Version access by role
- [Publishing](publishing.md) - Publish creates version
