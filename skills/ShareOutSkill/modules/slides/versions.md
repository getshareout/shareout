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
const version = await presentation.versions.create(
  'Q4 Final Draft',
  'Ready for executive review'
);

console.log(version);
// {
//   id: 'ver_abc123',
//   name: 'Q4 Final Draft',
//   description: 'Ready for executive review',
//   slideCount: 12,
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
const versions = await presentation.versions.list();

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
await presentation.versions.restore('ver_abc123');

// This:
// 1. Creates an auto-save of current state (safety)
// 2. Replaces document with version snapshot
// 3. Notifies all connected clients
```

### Restore Behavior

- **Immediate:** All connected users see restored content
- **Non-destructive:** Auto-save created before restore
- **Full document:** Replaces slides, content, notes, metadata

---

## Comparing Versions

### Get Diff

```javascript
const diff = await presentation.versions.diff(
  'ver_abc123',  // from
  'ver_def456'   // to
);

console.log(diff);
// {
//   slides: {
//     added: ['slide-5', 'slide-6'],
//     removed: ['slide-3'],
//     modified: ['slide-1', 'slide-2'],
//     reordered: true
//   },
//   metadata: {
//     changed: ['title', 'defaultColors']
//   }
// }
```

### Diff Response

```typescript
interface VersionDiff {
  slides: {
    added: string[];      // Slide IDs added
    removed: string[];    // Slide IDs removed
    modified: string[];   // Slide IDs with content changes
    reordered: boolean;   // Order changed
  };
  metadata: {
    changed: string[];    // Changed meta field names
  };
}
```

### Visual Diff

Use diff data to highlight changes in UI:

```javascript
const diff = await presentation.versions.diff(oldVersion, newVersion);

// Highlight slides
diff.slides.added.forEach(id => markSlide(id, 'added'));
diff.slides.removed.forEach(id => markSlide(id, 'removed'));
diff.slides.modified.forEach(id => markSlide(id, 'modified'));
```

---

## Deleting Versions

```javascript
// Delete a specific version
await presentation.versions.delete('ver_abc123');
// Returns: true if deleted, false if not found
```

**Restrictions:**
- Cannot delete if only 1 version exists
- Auto-saves can always be deleted
- Named versions can be deleted (with confirmation in UI)

---

## Subscribing to Changes

```javascript
const unsubscribe = presentation.versions.subscribe(versions => {
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
CREATE TABLE presentation_versions (
  id TEXT PRIMARY KEY,
  presentation_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  -- Y.js snapshot data
  snapshot BLOB NOT NULL,          -- Full document state
  snapshot_sv BLOB NOT NULL,       -- State vector for diffing

  -- Metadata
  slide_count INTEGER NOT NULL,
  thumbnail_blob_id TEXT,          -- First slide thumbnail
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_auto_save BOOLEAN DEFAULT FALSE,

  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
);

CREATE INDEX idx_versions_presentation
  ON presentation_versions(presentation_id, created_at DESC);
```

### Snapshot Format

- **snapshot:** Y.js `encodeStateAsUpdate()` output
- **snapshot_sv:** Y.js `encodeStateVector()` for efficient diffing
- Binary format, typically 1-100KB per version

---

## Use Cases

### Pre-Meeting Checkpoint

```javascript
// Before important presentation
await presentation.versions.create(
  'Before Board Meeting',
  'Backup before any live changes'
);
```

### Review Workflow

```javascript
// Create version for review
await presentation.versions.create('For Review - v1');

// After feedback, compare changes
const diff = await presentation.versions.diff('ver_review', 'ver_current');
console.log(`${diff.slides.modified.length} slides changed`);
```

### Rollback Mistake

```javascript
// Something went wrong
const versions = await presentation.versions.list();
const lastGood = versions.find(v => v.name === 'Before Changes');
await presentation.versions.restore(lastGood.id);
```

### Version History UI

```javascript
// Display version timeline
const versions = await presentation.versions.list();

versions.forEach(v => {
  const item = createTimelineItem({
    title: v.isAutoSave ? `Auto-save` : v.name,
    date: formatDate(v.createdAt),
    author: v.createdBy.name,
    slides: v.slideCount,
    thumbnail: v.thumbnail,
    actions: {
      restore: () => presentation.versions.restore(v.id),
      compare: () => showDiff(v.id),
      delete: v.isAutoSave ? () => presentation.versions.delete(v.id) : null
    }
  });
  timeline.appendChild(item);
});
```

---

## Best Practices

1. **Name meaningful versions:** "Q4 Final" not "Version 5"
2. **Add descriptions:** Future you will thank you
3. **Create before major changes:** Easy rollback
4. **Review auto-saves:** Good recovery points
5. **Clean up old versions:** Delete unnecessary auto-saves
