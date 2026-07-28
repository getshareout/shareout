# Permissions

Two-level permission system: presentation-level via `sdk.collaborators` and optional per-slide ownership.

## Presentation-Level Permissions

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

## Per-Slide Ownership

Optional ownership for individual slides. Useful for:
- Assigned sections
- Review workflows
- Protected content
- Team collaboration

### Setting Slide Owner

```javascript
// Assign Alice as owner of slide 3
presentation.slides.setOwner('slide-3', 'alice-user-id');

// Clear ownership (any editor can edit)
presentation.slides.setOwner('slide-3', null);
```

### Checking Ownership

```javascript
const owner = presentation.slides.getOwner('slide-3');
// Returns userId or null
```

### Ownership Effects

When a slide has an owner:

| User | Can Edit | Notes |
|------|----------|-------|
| Slide owner | ✓ | Full edit access |
| Presentation owner | ✓ | Override access |
| Other editors | ✗ | Can view only |

```javascript
// Check if current user can edit slide
function canEditSlide(slideId) {
  const slideOwner = presentation.slides.getOwner(slideId);
  const myRole = await sdk.collaborators.getMyRole();
  const myId = getCurrentUserId();

  // Presentation owner can always edit
  if (myRole === 'owner') return true;

  // Editors can edit if no owner or they are the owner
  if (myRole === 'editor') {
    return slideOwner === null || slideOwner === myId;
  }

  return false;
}
```

---

## Slide Locking

Lock a slide to prevent ALL edits except by owner:

```javascript
// Lock slide (only owner can edit)
presentation.slides.lock('slide-3');

// Unlock slide (editors can edit again, respecting ownership)
presentation.slides.unlock('slide-3');

// Check lock status
const isLocked = presentation.slides.isLocked('slide-3');
```

### Lock vs Ownership

| State | Who Can Edit |
|-------|--------------|
| No owner, unlocked | Any editor |
| Has owner, unlocked | Owner + presentation owner |
| No owner, locked | Only presentation owner |
| Has owner, locked | Only slide owner + presentation owner |

### UI Indicators

```javascript
// Show lock indicator
presentation.slides.observe(slides => {
  slides.forEach(slide => {
    const indicator = getSlideIndicator(slide.id);

    if (slide.locked) {
      indicator.classList.add('locked');
      indicator.title = 'Locked';
    }

    if (slide.owner) {
      const ownerName = getUserName(slide.owner);
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
  presentation.slides.setContent('slide-3', '<h1>New</h1>');
} catch (e) {
  if (e.code === 'PERMISSION_DENIED') {
    showError('You do not have permission to edit this slide');
  }
}
```

### Error Codes

| Code | Meaning |
|------|---------|
| `PERMISSION_DENIED` | User lacks required role |
| `SLIDE_LOCKED` | Slide is locked and user is not owner |
| `SLIDE_OWNED` | Slide has different owner |

---

## Workflow Examples

### Team Section Assignment

```javascript
// Assign different team members to different sections
await presentation.slides.setOwner('slide-1', alice);  // Intro
await presentation.slides.setOwner('slide-2', alice);
await presentation.slides.setOwner('slide-3', bob);    // Data
await presentation.slides.setOwner('slide-4', bob);
await presentation.slides.setOwner('slide-5', carol);  // Conclusion

// Each person edits their section
// Others can view but not modify
```

### Review Lock

```javascript
// Lock slides after review approval
const approvedSlides = ['slide-1', 'slide-2', 'slide-3'];
approvedSlides.forEach(id => presentation.slides.lock(id));

// Unlocked slides can still be edited
// Locked slides are frozen until explicitly unlocked
```

### Executive Summary Protection

```javascript
// Only CEO can edit executive summary
presentation.slides.setOwner('slide-1', ceoUserId);
presentation.slides.lock('slide-1');

// Everyone can view, only CEO can edit
```

---

## Published Mode Permissions

Published presentations (`/p/{slug}`) have simpler permissions:

| Visibility | Access |
|------------|--------|
| `public` | Anyone on the internet with the link; discoverable |
| `private` | Only collaborators can view |

```javascript
// Set visibility
presentation.publish.setVisibility('public');

// Check current visibility
const visibility = presentation.meta.get().visibility;
```

### Published vs Editor Access

| User | Editor (`/a/`) | Published (`/p/`) |
|------|----------------|-------------------|
| Owner | Full access | View + present |
| Editor | Full access | View + present |
| Viewer | View only | View + present |
| Anonymous | No access | Based on visibility |

---

## Integration with Comments

Comments respect per-slide ownership:

```javascript
// Anyone can comment on any slide
await sdk.comments.add({
  content: 'This needs an update',
  contextId: `slide-${slideId}`,
  authorName: userName
});

// But only slide owner/presentation owner can resolve
// (if resolve feature is implemented)
```

---

## Best Practices

1. **Start open:** Don't over-lock initially
2. **Assign owners for large decks:** Clearer responsibility
3. **Lock after approval:** Prevent accidental changes
4. **Use viewer role for stakeholders:** They can view and comment
5. **Document ownership:** Make it clear who owns what
