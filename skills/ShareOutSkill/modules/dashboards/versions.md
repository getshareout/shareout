# Version History

Snapshot-based versioning with named versions, auto-save, and diff comparison.

## Overview

```
Timeline
────────────────────────────────────────────────────────────────►

  [Auto-save]   [Auto-save]   ["Draft 1"]   [Auto-save]   ["Final"]
      │             │              │             │             │
      ▼             ▼              ▼             ▼             ▼
    snap_1        snap_2        snap_3        snap_4        snap_5
                                  ▲                           ▲
                                  │                           │
                             Named version              Named version
```

## Creating Versions

### Named Versions

User-created checkpoints:

```javascript
const version = await dashboard.versions.create(
  'Q4 Final Dashboard',
  'Approved by stakeholders'
);

console.log(version);
// {
//   id: 'ver_abc123',
//   name: 'Q4 Final Dashboard',
//   description: 'Approved by stakeholders',
//   widgetCount: 8,
//   createdAt: '2026-05-27T14:30:00Z',
//   createdBy: { id: 'usr_xxx', name: 'Alice', email: 'alice@example.com' },
//   isAutoSave: false,
//   thumbnail: '$ORIGIN/blobs/...'
// }
```

### Auto-Save

Automatic checkpoints in background:

| Trigger | When |
|---------|------|
| Time-based | Every 5 minutes if changes detected |
| Event-based | Before presentation starts |
| Session-based | When last editor disconnects |

Auto-saves are marked with `isAutoSave: true`.

### Auto-Save Retention

- Keep last 10 auto-saves
- Delete oldest when limit reached
- Named versions are never auto-deleted

---

## Listing Versions

```javascript
const versions = await dashboard.versions.list();

// Returns array sorted by createdAt descending
// [
//   { id: 'ver_5', name: 'Final', isAutoSave: false, ... },
//   { id: 'ver_4', name: 'Auto-save', isAutoSave: true, ... },
//   { id: 'ver_3', name: 'Draft 1', isAutoSave: false, ... },
//   ...
// ]
```

### Filtering

```javascript
// Get only named versions
const named = versions.filter(v => !v.isAutoSave);

// Get versions by date range
const thisWeek = versions.filter(v =>
  new Date(v.createdAt) > weekAgo
);
```

---

## Restoring Versions

```javascript
// Restore to a previous version
await dashboard.versions.restore('ver_abc123');

// This:
// 1. Creates an auto-save of current state (safety)
// 2. Replaces document with version snapshot
// 3. Notifies all connected clients
```

### Restore Behavior

- **Immediate:** All connected users see restored content
- **Non-destructive:** Auto-save created before restore
- **Full document:** Replaces widgets, layout, filters, metadata

---

## Comparing Versions

### Get Diff

```javascript
const diff = await dashboard.versions.diff(
  'ver_abc123',  // from
  'ver_def456'   // to
);

console.log(diff);
// {
//   widgets: {
//     added: ['kpi-5', 'chart-3'],
//     removed: ['kpi-2'],
//     modified: ['kpi-1', 'table-1'],
//     reordered: true
//   },
//   layout: {
//     changed: ['kpi-1', 'chart-1']
//   },
//   filters: {
//     added: ['region'],
//     removed: [],
//     modified: ['dateRange']
//   },
//   metadata: {
//     changed: ['title', 'refreshInterval']
//   }
// }
```

### Diff Response

```typescript
interface VersionDiff {
  widgets: {
    added: string[];      // Widget IDs added
    removed: string[];    // Widget IDs removed
    modified: string[];   // Widget IDs with config changes
    reordered: boolean;   // Layout changed
  };
  layout: {
    changed: string[];    // Widgets with position changes
  };
  filters: {
    added: string[];      // Filter IDs added
    removed: string[];    // Filter IDs removed
    modified: string[];   // Filter IDs with changes
  };
  metadata: {
    changed: string[];    // Changed meta field names
  };
}
```

### Visual Diff

Use diff data to highlight changes in UI:

```javascript
const diff = await dashboard.versions.diff(oldVersion, newVersion);

// Highlight widgets
diff.widgets.added.forEach(id => markWidget(id, 'added'));
diff.widgets.removed.forEach(id => markWidget(id, 'removed'));
diff.widgets.modified.forEach(id => markWidget(id, 'modified'));
```

---

## Deleting Versions

```javascript
// Delete a specific version
await dashboard.versions.delete('ver_abc123');
// Returns: true if deleted, false if not found
```

**Restrictions:**
- Cannot delete if only 1 version exists
- Auto-saves can always be deleted
- Named versions can be deleted (with confirmation in UI)

---

## Subscribing to Changes

```javascript
const unsubscribe = dashboard.versions.subscribe(versions => {
  // Called when versions list changes
  // (new version created, version deleted, etc.)
  renderVersionList(versions);
});

// Later
unsubscribe();
```

---

## Version Storage

### Database Schema

```sql
CREATE TABLE dashboard_versions (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  -- Y.js snapshot data
  snapshot BLOB NOT NULL,          -- Full document state
  snapshot_sv BLOB NOT NULL,       -- State vector for diffing

  -- Metadata
  widget_count INTEGER NOT NULL,
  thumbnail_blob_id TEXT,          -- Dashboard thumbnail
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_auto_save BOOLEAN DEFAULT FALSE,

  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
);

CREATE INDEX idx_dashboard_versions
  ON dashboard_versions(dashboard_id, created_at DESC);
```

### Snapshot Format

- **snapshot:** Y.js `encodeStateAsUpdate()` output
- **snapshot_sv:** Y.js `encodeStateVector()` for efficient diffing
- Binary format, typically 5-200KB per version

---

## Use Cases

### Pre-Meeting Checkpoint

```javascript
// Before important meeting
await dashboard.versions.create(
  'Before Board Meeting',
  'Backup before any live changes'
);
```

### Review Workflow

```javascript
// Create version for review
await dashboard.versions.create('For Review - v1');

// After feedback, compare changes
const diff = await dashboard.versions.diff('ver_review', 'ver_current');
console.log(`${diff.widgets.modified.length} widgets changed`);
```

### Rollback Mistake

```javascript
// Something went wrong
const versions = await dashboard.versions.list();
const lastGood = versions.find(v => v.name === 'Before Changes');
await dashboard.versions.restore(lastGood.id);
```

### Version History UI

```javascript
// Display version timeline
const versions = await dashboard.versions.list();

versions.forEach(v => {
  const item = createTimelineItem({
    title: v.isAutoSave ? `Auto-save` : v.name,
    date: formatDate(v.createdAt),
    author: v.createdBy.name,
    widgets: v.widgetCount,
    thumbnail: v.thumbnail,
    actions: {
      restore: () => dashboard.versions.restore(v.id),
      compare: () => showDiff(v.id),
      delete: v.isAutoSave ? () => dashboard.versions.delete(v.id) : null
    }
  });
  timeline.appendChild(item);
});
```

---

## Best Practices

1. **Name meaningful versions:** "Q4 Dashboard Final" not "Version 5"
2. **Add descriptions:** Future you will thank you
3. **Create before major changes:** Easy rollback
4. **Review auto-saves:** Good recovery points
5. **Clean up old versions:** Delete unnecessary auto-saves
