# Data Model

ShareOut Dashboards uses a Y.js CRDT document for real-time collaboration. This document describes the structure.

## Document Overview

Single realtime document per dashboard: `sdk.realtime('dashboard-{id}')`

```
Y.Doc
├── meta (Y.Map)              → Dashboard metadata, cascading properties
├── widgets (Y.Map)           → Widget definitions keyed by widgetId
├── widgetContent (Y.Map)     → Widget HTML content keyed by widgetId
├── layout (Y.Map)            → Grid positions keyed by widgetId
├── dataSources (Y.Map)       → Data connection configurations
├── filters (Y.Map)           → Global filter state
├── filterDefs (Y.Array)      → Filter definitions
├── filterPresets (Y.Map)     → Saved filter combinations
├── interactions (Y.Map)      → Cross-widget interaction configs
└── presentationState (Y.Map) → Live presentation state
```

---

## meta (Y.Map)

Dashboard-level properties that cascade to all widgets.

```typescript
interface DashboardMeta {
  // Identity
  id: string;
  title: string;
  description: string;

  // Layout
  layout: 'fixed' | 'responsive';
  columns: number;       // Grid columns (default: 12)
  rowHeight: number;     // Row height in px (default: 80)
  gap: number;           // Grid gap in px
  padding: number;       // Dashboard padding

  // Cascading visual properties
  defaultFont: {
    heading: string;     // e.g., 'Inter'
    body: string;
    mono: string;
  };

  defaultColors: {
    background: string;  // Dashboard background
    surface: string;     // Widget background
    text: string;
    textSecondary: string;
    accent: string;
    positive: string;    // Green for positive metrics
    negative: string;    // Red for negative metrics
    neutral: string;
  };

  // Data defaults
  refreshInterval: number | null;  // Auto-refresh in seconds
  timezone: string;
  dateFormat: string;
  numberFormat: {
    locale: string;
    currency?: string;
  };

  // Ownership
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

### Cascading Behavior

Properties in `meta` are inherited by all widgets unless a widget specifies an override:

```javascript
// Set dashboard defaults
dashboard.meta.set({
  defaultFont: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
  defaultColors: {
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    accent: '#3b82f6'
  }
});

// Widget 'kpi-1' overrides background
dashboard.widgets.update('kpi-1', {
  overrides: {
    surface: '#ffffff'
    // font and other properties still cascade from meta
  }
});
```

---

## widgets (Y.Map<string, Widget>)

Widget definitions keyed by widget ID.

```typescript
interface Widget {
  id: string;
  type: WidgetType;
  title: string;

  // Data binding
  dataSource: string | null;     // dataSource ID
  query?: DataQuery;             // Query/transform config

  // Visual
  config: WidgetConfig;          // Type-specific config
  overrides?: WidgetOverrides;   // Override cascading properties

  // State
  owner: string | null;          // userId - can edit even when locked
  locked: boolean;               // Prevent edits except by owner
}

type WidgetType =
  | 'kpi'       // Single big number
  | 'chart'     // Line, bar, pie, etc.
  | 'table'     // Data table
  | 'text'      // Rich text/markdown
  | 'image'     // Static image
  | 'embed'     // iframe embed
  | 'filter'    // Filter control widget
  | 'html';     // Free-form HTML

interface WidgetOverrides {
  surface?: string;
  font?: {
    heading?: string;
    body?: string;
    mono?: string;
  };
}

interface DataQuery {
  filter?: Record<string, any>;
  sort?: { field: string; order: 'asc' | 'desc' };
  limit?: number;
  transform?: string;  // JavaScript transform expression
}
```

---

## widgetContent (Y.Map<string, Y.Text>)

Widget HTML content for html/text widgets. Each widget's content is a Y.Text for collaborative editing.

```
widgetContent: {
  'html-widget-1': Y.Text('<div class="custom-viz">...</div>'),
  'text-widget-2': Y.Text('## Section Header\nNotes here...'),
  ...
}
```

### Why Y.Text for HTML?

- **Conflict-free:** Multiple users editing same widget merge cleanly
- **Character-level sync:** See collaborator's edits in real-time
- **Rich binding:** Works with contenteditable, Monaco, CodeMirror

---

## layout (Y.Map<string, LayoutItem>)

Grid positions for each widget.

```typescript
interface LayoutItem {
  widgetId: string;
  x: number;      // Grid column start (0-indexed)
  y: number;      // Grid row start
  w: number;      // Width in columns
  h: number;      // Height in rows
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
}
```

### Grid System

```
12-column grid:
┌─┬─┬─┬─┬─┬─┬─┬─┬─┬──┬──┬──┐
│0│1│2│3│4│5│6│7│8│9 │10│11│
└─┴─┴─┴─┴─┴─┴─┴─┴─┴──┴──┴──┘

Example layout:
┌──────────┬──────────┬──────────┬──────────┐
│  KPI     │  KPI     │  KPI     │  KPI     │ y=0, h=2
│  w=3     │  w=3     │  w=3     │  w=3     │
├──────────┴──────────┼──────────┴──────────┤
│                     │                     │ y=2, h=4
│    Line Chart       │    Bar Chart        │
│    w=6              │    w=6              │
├─────────────────────┴─────────────────────┤
│                                           │ y=6, h=5
│              Data Table                   │
│              w=12                         │
└───────────────────────────────────────────┘
```

---

## dataSources (Y.Map<string, DataSource>)

Data connection configurations.

```typescript
interface DataSource {
  id: string;
  name: string;
  type: DataSourceType;
  config: DataSourceConfig;
  refreshInterval?: number;   // Auto-refresh in seconds
  lastRefreshed?: string;     // ISO timestamp
}

type DataSourceType =
  | 'static'       // JSON data embedded
  | 'api'          // REST API endpoint
  | 'sql'          // SQL query (via proxy)
  | 'shareout'     // ShareOut table
  | 'csv'          // Uploaded CSV
  | 'websocket';   // Real-time stream

interface DataSourceConfig {
  // For 'static'
  data?: any[];

  // For 'api'
  url?: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: any;

  // For 'sql' (proxied through secure backend)
  connectionId?: string;
  query?: string;

  // For 'shareout'
  tableId?: string;

  // For 'csv'
  blobId?: string;

  // For 'websocket'
  wsUrl?: string;
  channel?: string;
}
```

### Data Flow

```
DataSource Config → Fetch/Query → Raw Data → Widget Query → Filtered Data → Render
                                     ↑
                                     │
                              Filter State
```

---

## filters (Y.Map<string, FilterValue>)

Current filter state.

```typescript
interface FilterState {
  [filterId: string]: FilterValue;
}

type FilterValue =
  | string                          // Single select
  | string[]                        // Multi select
  | { from: string; to: string }    // Date range
  | { min: number; max: number };   // Number range
```

**Example:**

```
filters: {
  'region': 'na',
  'status': ['active', 'pending'],
  'dateRange': { from: '2026-01-01', to: '2026-12-31' },
  'revenue': { min: 10000, max: 1000000 }
}
```

---

## filterDefs (Y.Array<FilterDefinition>)

Filter definitions (what filters exist and their configuration).

```typescript
interface FilterDefinition {
  id: string;
  type: 'select' | 'multiselect' | 'daterange' | 'numberrange' | 'search';
  label: string;
  dataSource?: string;           // Source for dynamic options
  field?: string;                // Field for dynamic options
  options?: { value: string; label: string }[];  // Static options
  defaultValue?: FilterValue;
  affects: string[];             // Widget IDs this filter affects ('*' for all)
}
```

---

## filterPresets (Y.Map<string, FilterPreset>)

Saved filter combinations for quick access.

```typescript
interface FilterPreset {
  id: string;
  name: string;
  description?: string;
  icon?: string;              // Emoji or icon name
  color?: string;             // Badge color

  filters: FilterState;       // Saved filter values

  isDefault: boolean;         // Auto-apply on load
  isPinned: boolean;          // Show in quick-access bar
  isShared: boolean;          // Visible to all collaborators

  createdBy: string;
  createdAt: string;
}
```

**Example:**

```
filterPresets: {
  'preset-q4': {
    id: 'preset-q4',
    name: 'Q4 2026',
    icon: '📊',
    filters: {
      dateRange: { from: '2026-10-01', to: '2026-12-31' }
    },
    isPinned: true,
    isShared: true
  },
  'preset-my-region': {
    id: 'preset-my-region',
    name: 'My Region',
    filters: {
      region: ['West Coast']
    },
    isPinned: true,
    isShared: false  // Personal preset
  }
}
```

---

## interactions (Y.Map<string, InteractionConfig>)

Cross-widget interaction definitions.

```typescript
interface InteractionConfig {
  id: string;
  trigger: {
    widgetId: string;
    event: 'click' | 'select' | 'hover';
    field?: string;
  };
  action: {
    type: 'filter' | 'navigate' | 'highlight' | 'custom';
    target: string | string[];  // Widget IDs or '*'
    config: any;
  };
}
```

**Example:**

```
interactions: {
  'chart-filter-table': {
    id: 'chart-filter-table',
    trigger: {
      widgetId: 'sales-chart',
      event: 'click',
      field: 'region'
    },
    action: {
      type: 'filter',
      target: ['sales-table', 'kpi-revenue'],
      config: { filterField: 'region' }
    }
  }
}
```

---

## presentationState (Y.Map)

Live presentation state. Updates during presenter mode.

```typescript
interface DashboardPresentationState {
  isPresenting: boolean;
  presenterId: string | null;
  presenterName: string | null;
  focusedWidgetId: string | null;
  startedAt: number | null;        // Unix timestamp

  countdown: {
    total: number;
    remaining: number;
    paused: boolean;
  } | null;

  cycling: {
    active: boolean;
    currentIndex: number;
    widgetIds: string[];
    interval: number;
  } | null;

  pointer: {
    enabled: boolean;
    position: { x: number; y: number } | null;
  };
}
```

### Sync Protocol

Presenter updates `presentationState`. Viewers subscribe:

```javascript
// Presenter
dashboard.presenter.focusWidget('kpi-revenue');
// → Updates presentationState.focusedWidgetId = 'kpi-revenue'

// Viewer (via presence subscription)
dashboard.presenter.subscribe(state => {
  if (!dashboard.presenter.isPresenter()) {
    focusWidget(state.focusedWidgetId);
    renderPointer(state.pointer);
  }
});
```

---

## Y.js Operations

### Transactions

Batch multiple changes for atomic undo/redo:

```javascript
dashboard.transact(() => {
  const widget = dashboard.widgets.add('kpi', config, position);
  dashboard.widgets.setOwner(widget.id, userId);
  dashboard.layout.update(widget.id, { x: 0, y: 0, w: 3, h: 2 });
});
// Single undo step
```

### Observing Changes

```javascript
// Observe widget list
dashboard.widgets.observe(widgets => {
  renderWidgets(widgets);
});

// Observe specific widget content
const content = dashboard.widgets.getContent('html-1');
content.observe(() => {
  renderWidget('html-1', content.toString());
});

// Observe layout
dashboard.layout.observe(layout => {
  repositionWidgets(layout);
});

// Observe filters
dashboard.filters.observe(state => {
  refreshFilteredData(state);
});
```

### Undo/Redo

Per-user undo stack:

```javascript
const undoMgr = dashboard.undo.manager();

// User A makes changes → A can undo
// User B makes changes → B can undo B's changes
// Undo is scoped to user's own changes
```

---

## Presence Layer

Not stored in document - ephemeral state via WebSocket.

```typescript
interface DashboardPresenceState {
  user: {
    id: string;
    name: string;
    avatar: string | null;
    color: string;           // Assigned cursor color
  };

  viewingWidgetId: string | null;
  editingWidgetId: string | null;
  selectedWidgetIds: string[];

  cursor: { x: number; y: number } | null;
  pointer: { x: number; y: number } | null;

  mode: 'edit' | 'view' | 'configure' | 'present';
  lastActive: number;
}
```

---

## Storage Architecture

### Live Document

Y.js document stored in ShareOut's realtime infrastructure:
- WebSocket connection to `/v1/data/{artifactId}/realtime/{docName}`
- Binary Y.js protocol (0x00, 0x01, 0x02 messages)
- Automatic persistence to durable storage

### Version Snapshots

Stored separately for efficient restoration:

```
dashboard_versions table:
├── id
├── dashboard_id
├── name
├── description
├── snapshot (Y.js encoded state as binary)
├── snapshot_sv (state vector for diffing)
├── widget_count
├── thumbnail_blob_id
├── created_by
├── created_at
└── is_auto_save
```

### Data Cache

Live data from data sources cached separately:
- In-memory cache for recent fetches
- Auto-invalidated on refresh interval
- Not persisted in Y.js document

### Media

Images stored via `sdk.blobs`:
- Referenced in widget config by blob ID or CDN URL
- Not embedded in Y.js document
- Separate storage with 50MB/file limit
