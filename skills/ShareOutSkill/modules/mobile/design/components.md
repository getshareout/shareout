# Mobile Components

Native-feeling UI components for mobile experiences.

---

## Lists

### Basic List

```
┌─────────────────────────────────────────┐
│ ┌───┐                                   │
│ │ 🖼 │  Title                        →  │
│ │   │  Subtitle text here              │
│ └───┘                                   │
├─────────────────────────────────────────┤
│ ┌───┐                                   │
│ │ 🖼 │  Another Item                 →  │
│ │   │  Secondary info                  │
│ └───┘                                   │
└─────────────────────────────────────────┘
```

```html
<ul class="so-list">
  <li class="so-list-item">
    <div class="so-list-item-media">
      <img src="..." alt="">
    </div>
    <div class="so-list-item-content">
      <div class="so-list-item-title">Title</div>
      <div class="so-list-item-subtitle">Subtitle</div>
    </div>
    <div class="so-list-item-action">
      <span class="so-icon">chevron-right</span>
    </div>
  </li>
</ul>
```

```css
.so-list-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  min-height: 56px;
  gap: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.so-list-item:active {
  background: rgba(0, 0, 0, 0.05);
}
```

### Swipeable List Item

```javascript
ShareOut.mobile.list({
  container: '#list',

  swipeActions: {
    left: [
      { icon: 'trash', color: '#ef4444', label: 'Delete' }
    ],
    right: [
      { icon: 'check', color: '#10b981', label: 'Done' }
    ]
  },

  onAction: (itemId, action) => {
    if (action === 'trash') deleteItem(itemId);
    if (action === 'check') completeItem(itemId);
  }
});
```

### Grouped List (iOS-style)

```
┌─────────────────────────────────┐
│ ACCOUNT                         │
├─────────────────────────────────┤
│ Profile                      →  │
├─────────────────────────────────┤
│ Notifications                →  │
├─────────────────────────────────┤
│ Privacy                      →  │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ ABOUT                           │
├─────────────────────────────────┤
│ Version                    1.0  │
├─────────────────────────────────┤
│ Terms of Service             →  │
└─────────────────────────────────┘
```

---

## Cards

### Basic Card

```
┌─────────────────────────────────┐
│ ┌─────────────────────────────┐ │
│ │                             │ │
│ │         Image/Media         │ │
│ │                             │ │
│ └─────────────────────────────┘ │
│                                 │
│ Card Title                      │
│ Supporting text that provides   │
│ more context about this card.   │
│                                 │
│ [Action 1]      [Action 2]      │
└─────────────────────────────────┘
```

```css
.so-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  overflow: hidden;
}

.so-card-media {
  aspect-ratio: 16/9;
  object-fit: cover;
}

.so-card-content {
  padding: 16px;
}

.so-card-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
}

.so-card-actions {
  display: flex;
  gap: 8px;
  padding: 8px 16px 16px;
}
```

### Horizontal Card

```
┌──────────────────────────────────────────┐
│ ┌──────┐                                 │
│ │      │  Title                       →  │
│ │ 🖼   │  Description text              │
│ │      │  Metadata                       │
│ └──────┘                                 │
└──────────────────────────────────────────┘
```

---

## Buttons

### Button Types

```
┌────────────────┐  Primary (filled)
│    Button      │
└────────────────┘

┌────────────────┐  Secondary (outlined)
│    Button      │
└────────────────┘

    Button         Text (minimal)

┌─────┐
│  +  │           FAB (floating action)
└─────┘
```

### Button Sizes

```css
.so-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.15s;
}

.so-button-sm {
  height: 36px;
  padding: 0 12px;
  font-size: 14px;
}

.so-button-md {
  height: 44px;
  padding: 0 16px;
  font-size: 16px;
}

.so-button-lg {
  height: 52px;
  padding: 0 24px;
  font-size: 18px;
}

/* Full-width */
.so-button-block {
  width: 100%;
}

/* Touch feedback */
.so-button:active {
  transform: scale(0.98);
  opacity: 0.9;
}
```

### Floating Action Button (FAB)

```javascript
ShareOut.mobile.fab({
  icon: 'plus',
  position: 'bottom-right',  // bottom-right, bottom-center, bottom-left

  // Extended FAB with label
  extended: {
    label: 'New Item',
    collapseOnScroll: true
  },

  // Multiple actions (speed dial)
  actions: [
    { icon: 'camera', label: 'Photo', onPress: takePhoto },
    { icon: 'document', label: 'File', onPress: uploadFile },
    { icon: 'link', label: 'Link', onPress: addLink }
  ],

  onPress: () => createNewItem(),

  style: {
    background: '#3b82f6',
    color: '#ffffff',
    size: 56,
    margin: 16
  }
});
```

---

## Form Inputs

### Text Input

```
┌─────────────────────────────────┐
│ Label                           │
│ ┌─────────────────────────────┐ │
│ │ Placeholder text            │ │
│ └─────────────────────────────┘ │
│ Helper text                     │
└─────────────────────────────────┘
```

```css
.so-input-group {
  margin-bottom: 16px;
}

.so-input-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 6px;
  color: #374151;
}

.so-input {
  width: 100%;
  height: 48px;
  padding: 0 16px;
  font-size: 16px;  /* Prevents zoom on iOS */
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: white;
}

.so-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.so-input-helper {
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
}

.so-input-error {
  border-color: #ef4444;
}

.so-input-error-text {
  color: #ef4444;
}
```

### Select / Picker

```javascript
ShareOut.mobile.picker({
  element: '#select',
  type: 'bottom-sheet',  // or 'native'

  options: [
    { value: 'opt1', label: 'Option 1' },
    { value: 'opt2', label: 'Option 2' },
    { value: 'opt3', label: 'Option 3' }
  ],

  // Multi-select
  multiple: false,

  // Search/filter
  searchable: true,
  searchPlaceholder: 'Search...',

  onChange: (value) => {}
});
```

### Toggle / Switch

```
┌────────────────────────────────────────┐
│ Notifications                    [●━━] │
├────────────────────────────────────────┤
│ Dark Mode                        [━━○] │
└────────────────────────────────────────┘
```

```css
.so-toggle {
  position: relative;
  width: 51px;
  height: 31px;
  background: #e5e7eb;
  border-radius: 31px;
  cursor: pointer;
  transition: background 0.2s;
}

.so-toggle.active {
  background: #3b82f6;
}

.so-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  background: white;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: transform 0.2s;
}

.so-toggle.active .so-toggle-knob {
  transform: translateX(20px);
}
```

### Checkbox / Radio

```
┌────────────────────────────────────────┐
│ ☑ Option A (checked)                   │
├────────────────────────────────────────┤
│ ☐ Option B                             │
├────────────────────────────────────────┤
│ ◉ Radio Selected                       │
├────────────────────────────────────────┤
│ ○ Radio Unselected                     │
└────────────────────────────────────────┘
```

---

## Search

### Search Bar

```
┌─────────────────────────────────────────┐
│ 🔍 Search...                        ✕   │
└─────────────────────────────────────────┘
```

```javascript
ShareOut.mobile.search({
  container: '#search-bar',
  placeholder: 'Search...',

  // Behavior
  autoFocus: false,
  clearButton: true,
  cancelButton: true,  // iOS-style "Cancel" text

  // Debounce search
  debounce: 300,

  // Callbacks
  onSearch: (query) => performSearch(query),
  onClear: () => clearResults(),
  onCancel: () => closeSearch(),

  // Recent searches
  recentSearches: {
    enabled: true,
    max: 5,
    storage: 'localStorage'
  }
});
```

### Search with Results

```
┌─────────────────────────────────────────┐
│ 🔍 coffee                          ✕   │
├─────────────────────────────────────────┤
│ Recent                                  │
│ ○ coffee shops                          │
│ ○ coffee recipes                        │
├─────────────────────────────────────────┤
│ Suggestions                             │
│ ○ coffee makers                         │
│ ○ coffee beans                          │
└─────────────────────────────────────────┘
```

---

## Alerts & Dialogs

### Alert Dialog

```
┌─────────────────────────────────────┐
│                                     │
│           Delete Item?              │
│                                     │
│  This action cannot be undone.      │
│  Are you sure you want to delete    │
│  this item?                         │
│                                     │
│  ┌──────────┐   ┌──────────────┐   │
│  │  Cancel  │   │    Delete    │   │
│  └──────────┘   └──────────────┘   │
│                       ↑ red         │
└─────────────────────────────────────┘
```

```javascript
ShareOut.mobile.alert({
  title: 'Delete Item?',
  message: 'This action cannot be undone.',

  buttons: [
    {
      text: 'Cancel',
      style: 'cancel',
      onPress: () => {}
    },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: () => deleteItem()
    }
  ]
});
```

### Action Sheet

```
┌─────────────────────────────────────┐
│                                     │
│  (dimmed content)                   │
│                                     │
├─════════════════════════════════════┤
│         ━━━ (drag handle)           │
│                                     │
│  ┌─────────────────────────────┐   │
│  │      📷  Take Photo         │   │
│  ├─────────────────────────────┤   │
│  │      🖼  Choose from Library │   │
│  ├─────────────────────────────┤   │
│  │      📄  Choose File        │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │         Cancel              │   │
│  └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

```javascript
ShareOut.mobile.actionSheet({
  actions: [
    { icon: 'camera', text: 'Take Photo', onPress: takePhoto },
    { icon: 'image', text: 'Choose from Library', onPress: pickImage },
    { icon: 'document', text: 'Choose File', onPress: pickFile }
  ],
  cancelText: 'Cancel'
});
```

---

## Toast / Snackbar

```
┌─────────────────────────────────────────┐
│                                         │
│           Main Content                  │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│  Item deleted                  [Undo]   │
└─────────────────────────────────────────┘
```

```javascript
ShareOut.mobile.toast({
  message: 'Item deleted',
  duration: 4000,  // ms, or 'short' (2000) / 'long' (4000)
  position: 'bottom',  // top, bottom

  // Optional action
  action: {
    text: 'Undo',
    onPress: () => undoDelete()
  },

  // Style
  style: {
    background: '#1f2937',
    color: '#ffffff'
  }
});
```

---

## Skeleton Loading

```
┌─────────────────────────────────────────┐
│ ████████████                            │
│ ██████████████████████████████         │
│ ██████████████████████                 │
├─────────────────────────────────────────┤
│ ┌────┐ ████████████████                │
│ │ ██ │ ██████████████                  │
│ └────┘                                  │
├─────────────────────────────────────────┤
│ ┌────┐ ████████████████                │
│ │ ██ │ ██████████████                  │
│ └────┘                                  │
└─────────────────────────────────────────┘
```

```css
.so-skeleton {
  background: linear-gradient(
    90deg,
    #e5e7eb 25%,
    #f3f4f6 50%,
    #e5e7eb 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.so-skeleton-text {
  height: 16px;
  margin-bottom: 8px;
}

.so-skeleton-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
}

.so-skeleton-image {
  width: 100%;
  aspect-ratio: 16/9;
}
```

---

## Pull-to-Refresh Indicator

```javascript
// Custom refresh indicator
ShareOut.mobile.pullToRefresh({
  element: '#content',

  indicator: {
    type: 'spinner',  // spinner, dots, custom
    color: '#3b82f6',
    size: 24
  },

  // Or custom HTML
  customIndicator: `
    <div class="custom-loader">
      <svg>...</svg>
    </div>
  `,

  text: {
    pull: 'Pull to refresh',
    release: 'Release to refresh',
    refreshing: 'Refreshing...',
    complete: 'Done!'
  }
});
```

---

## Empty States

```
┌─────────────────────────────────────────┐
│                                         │
│                 📭                      │
│                                         │
│           No items yet                  │
│                                         │
│    Start by creating your first item   │
│                                         │
│         [ Create Item ]                 │
│                                         │
└─────────────────────────────────────────┘
```

```html
<div class="so-empty-state">
  <div class="so-empty-state-icon">📭</div>
  <h3 class="so-empty-state-title">No items yet</h3>
  <p class="so-empty-state-description">
    Start by creating your first item
  </p>
  <button class="so-button so-button-primary">
    Create Item
  </button>
</div>
```

---

## Badges

```
Numeric:     [  3  ]   [ 99+ ]
Dot:         ●
Status:      🟢 Online   🔴 Offline   🟡 Away
```

```css
.so-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: white;
  background: #ef4444;
  border-radius: 10px;
}

.so-badge-dot {
  width: 8px;
  height: 8px;
  padding: 0;
  min-width: 8px;
}

/* Position on icon */
.so-badge-container {
  position: relative;
}

.so-badge-container .so-badge {
  position: absolute;
  top: -4px;
  right: -4px;
}
```

---

## Progress Indicators

### Linear Progress

```
Determinate:    ████████████░░░░░░░  67%
Indeterminate:  ▓▓▓▓░░░░░░░░░░░░░░░ (animated)
```

### Circular Progress

```
      ╭──╮
     ╱    ╲
    │  67% │
     ╲    ╱
      ╰──╯
```

```css
.so-progress {
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  overflow: hidden;
}

.so-progress-bar {
  height: 100%;
  background: #3b82f6;
  transition: width 0.3s;
}

/* Indeterminate animation */
.so-progress-indeterminate .so-progress-bar {
  width: 30%;
  animation: progress-indeterminate 1.5s infinite;
}

@keyframes progress-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
```
