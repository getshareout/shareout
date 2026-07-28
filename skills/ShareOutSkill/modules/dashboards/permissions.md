# Permissions

Two-level permission system: dashboard-level via `sdk.collaborators` and optional per-widget ownership.

## Dashboard-Level Permissions

Uses ShareOut's standard collaborator system.

### Roles

| Role | View | Edit | Present | Versions | Manage Collaborators | Delete |
|------|------|------|---------|----------|---------------------|--------|
| **owner** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **editor** | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **viewer** | ✓ | ✗ | ✗ | ✓ (read) | ✗ | ✗ |

### Managing Collaborators

```javascript
// Add editors
await sdk.collaborators.add(['alice@example.com'], 'editor');

// Add viewers
await sdk.collaborators.add(['bob@example.com', 'carol@example.com'], 'viewer');

// List all collaborators
const collaborators = await sdk.collaborators.list();
// [
//   { email: 'owner@example.com', role: 'owner', added_at: '...' },
//   { email: 'alice@example.com', role: 'editor', added_at: '...' },
//   { email: 'bob@example.com', role: 'viewer', added_at: '...' }
// ]

// Change role (re-add with new role)
await sdk.collaborators.add(['bob@example.com'], 'editor');

// Remove collaborator
await sdk.collaborators.remove('carol@example.com');

// Transfer ownership
await sdk.collaborators.transferOwnership('alice@example.com');
```

### Checking Permissions

```javascript
const myRole = await sdk.collaborators.getMyRole();

if (myRole === 'owner' || myRole === 'editor') {
  showEditControls();
} else {
  showViewOnlyMode();
}
```

---

## Per-Widget Ownership

Optional ownership for individual widgets. Useful for:
- Assigned sections
- Review workflows
- Protected metrics
- Team collaboration

### Setting Widget Owner

```javascript
// Assign Alice as owner of revenue KPI
dashboard.widgets.setOwner('kpi-revenue', 'alice-user-id');

// Clear ownership (any editor can edit)
dashboard.widgets.setOwner('kpi-revenue', null);
```

### Checking Ownership

```javascript
const owner = dashboard.widgets.get('kpi-revenue')?.owner;
// Returns userId or null
```

### Ownership Effects

When a widget has an owner:

| User | Can Edit | Notes |
|------|----------|-------|
| Widget owner | ✓ | Full edit access |
| Dashboard owner | ✓ | Override access |
| Other editors | ✗ | Can view only |

```javascript
// Check if current user can edit widget
function canEditWidget(widgetId) {
  const widget = dashboard.widgets.get(widgetId);
  const myRole = await sdk.collaborators.getMyRole();
  const myId = getCurrentUserId();

  // Dashboard owner can always edit
  if (myRole === 'owner') return true;

  // Editors can edit if no owner or they are the owner
  if (myRole === 'editor') {
    return widget.owner === null || widget.owner === myId;
  }

  return false;
}
```

---

## Widget Locking

Lock a widget to prevent ALL edits except by owner:

```javascript
// Lock widget (only owner can edit)
dashboard.widgets.lock('kpi-revenue');

// Unlock widget (editors can edit again, respecting ownership)
dashboard.widgets.unlock('kpi-revenue');

// Check lock status
const widget = dashboard.widgets.get('kpi-revenue');
const isLocked = widget?.locked;
```

### Lock vs Ownership

| State | Who Can Edit |
|-------|--------------|
| No owner, unlocked | Any editor |
| Has owner, unlocked | Owner + dashboard owner |
| No owner, locked | Only dashboard owner |
| Has owner, locked | Only widget owner + dashboard owner |

### UI Indicators

```javascript
// Show lock indicator
dashboard.widgets.observe(widgets => {
  widgets.forEach(widget => {
    const indicator = getWidgetIndicator(widget.id);

    if (widget.locked) {
      indicator.classList.add('locked');
      indicator.title = 'Locked';
    }

    if (widget.owner) {
      const ownerName = getUserName(widget.owner);
      indicator.classList.add('has-owner');
      indicator.title = `Owned by ${ownerName}`;
    }
  });
});
```

---

## Permission Errors

```javascript
try {
  dashboard.widgets.update('kpi-revenue', { title: 'New Title' });
} catch (e) {
  if (e.code === 'PERMISSION_DENIED') {
    showError('You do not have permission to edit this widget');
  }
}
```

### Error Codes

| Code | Meaning |
|------|---------|
| `PERMISSION_DENIED` | User lacks required role |
| `WIDGET_LOCKED` | Widget is locked and user is not owner |
| `WIDGET_OWNED` | Widget has different owner |

---

## Workflow Examples

### Team Section Assignment

```javascript
// Assign different team members to different widgets
await dashboard.widgets.setOwner('kpi-revenue', alice);
await dashboard.widgets.setOwner('kpi-costs', alice);
await dashboard.widgets.setOwner('chart-sales', bob);
await dashboard.widgets.setOwner('table-pipeline', bob);
await dashboard.widgets.setOwner('kpi-customers', carol);

// Each person edits their widgets
// Others can view but not modify
```

### Review Lock

```javascript
// Lock widgets after review approval
const approvedWidgets = ['kpi-revenue', 'chart-trend', 'table-top'];
approvedWidgets.forEach(id => dashboard.widgets.lock(id));

// Unlocked widgets can still be edited
// Locked widgets are frozen until explicitly unlocked
```

### Executive KPI Protection

```javascript
// Only CFO can edit financial KPIs
dashboard.widgets.setOwner('kpi-revenue', cfoUserId);
dashboard.widgets.setOwner('kpi-profit', cfoUserId);
dashboard.widgets.lock('kpi-revenue');
dashboard.widgets.lock('kpi-profit');

// Everyone can view, only CFO can edit
```

---

## Published Mode Permissions

Published dashboards (`/p/{slug}`) have simpler permissions:

| Visibility | Access |
|------------|--------|
| `public` | Anyone on the internet with the link; discoverable |
| `private` | Only collaborators can view |

```javascript
// Set visibility
dashboard.publish.setVisibility('public');

// Check current visibility
const meta = dashboard.meta.get();
console.log(meta.visibility);
```

### Published vs Editor Access

| User | Editor (`/a/`) | Published (`/p/`) |
|------|----------------|-------------------|
| Owner | Full access | View + interact |
| Editor | Full access | View + interact |
| Viewer | View only | View + interact |
| Anonymous | No access | Based on visibility |

---

## Filter Preset Permissions

Filter presets can be personal or shared:

```javascript
// Personal preset (only creator sees)
dashboard.presets.create({
  name: 'My View',
  filters: dashboard.filters.getState(),
  isShared: false
});

// Shared preset (all collaborators see)
dashboard.presets.create({
  name: 'Team Default',
  filters: dashboard.filters.getState(),
  isShared: true
});
```

### Preset Editing

| Preset Type | Who Can Edit |
|-------------|--------------|
| Personal | Creator only |
| Shared | Any editor |

---

## Integration with Comments

Comments respect per-widget ownership:

```javascript
// Anyone can comment on any widget
await sdk.comments.add({
  content: 'This KPI needs an update',
  contextId: `widget-${widgetId}`,
  authorName: userName
});

// But only widget owner/dashboard owner can resolve
// (if resolve feature is implemented)
```

---

## Best Practices

1. **Start open:** Don't over-lock initially
2. **Assign owners for large dashboards:** Clearer responsibility
3. **Lock after approval:** Prevent accidental changes
4. **Use viewer role for stakeholders:** They can view and comment
5. **Document ownership:** Make it clear who owns what
