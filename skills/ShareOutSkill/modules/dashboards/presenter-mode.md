# Presenter Mode

Dashboard presentation system with widget focus, auto-cycling, timer, and pointer sync.

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PRESENTER                                   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │   DASHBOARD VIEW                                              │  │
│  │                                                               │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │  │
│  │  │  KPI    │ │  KPI    │ │  KPI    │ │  KPI    │            │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘            │  │
│  │                                                               │  │
│  │  ┌───────────────────────┐ ┌────────────────────────────┐   │  │
│  │  │                       │ │  ████████████████████      │   │  │
│  │  │    ▶ FOCUSED WIDGET   │ │  ████████████              │   │  │
│  │  │      (highlighted)    │ │  ████████                  │   │  │
│  │  │                  🔴   │ │  ████                      │   │  │
│  │  │            (pointer)  │ │  ██                        │   │  │
│  │  └───────────────────────┘ └────────────────────────────┘   │  │
│  │                                                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ [◄ Prev] [Next ►]  |  Timer: 05:23  |  Countdown: 24:37       ││
│  │ [🔴 Pointer] [⟳ Cycle] [⬛ End]  |  Widget 2 of 8             ││
│  └────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket sync
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         VIEWER                                       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │              SAME DASHBOARD VIEW                              │  │
│  │              (follows presenter's focus)                      │  │
│  │              (sees pointer position)                          │  │
│  │                                                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Starting Presenter Mode

```javascript
// Start presenting
await dashboard.presenter.start({
  countdown: 1800,        // 30-minute timer
  hideFilters: true       // Hide filter controls
});

// Viewers auto-sync to presenter
// Filters locked during presentation
```

### Start Options

```typescript
interface PresenterOptions {
  focusWidgetId?: string;      // Start focused on specific widget
  countdown?: number;           // Meeting timer in seconds
  hideFilters?: boolean;        // Hide filter controls during presentation
  autoRefresh?: boolean;        // Keep data refreshing (default: true)
}
```

## Widget Focus

Highlight and zoom a specific widget for discussion.

### Focus Navigation

```javascript
// Focus on specific widget
dashboard.presenter.focusWidget('kpi-revenue');
// → Widget highlighted, others dimmed
// → Viewers see the same focus

// Clear focus (show all)
dashboard.presenter.clearFocus();

// Navigate through widgets
dashboard.presenter.nextWidget();
dashboard.presenter.previousWidget();
```

### Focus Behavior

When a widget is focused:

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  ░░░░░░░░░  ░░░░░░░░░  ░░░░░░░░░  ░░░░░░░░░   ← Dimmed       │
│                                                               │
│  ░░░░░░░░░░░░░░░░░  ┌──────────────────────┐                 │
│  ░░░░░░░░░░░░░░░░░  │                      │                 │
│  ░░░░░░░░░░░░░░░░░  │   FOCUSED WIDGET     │  ← Highlighted  │
│  ░░░░░░░░░░░░░░░░░  │   (enlarged)         │                 │
│  ░░░░░░░░░░░░░░░░░  │                      │                 │
│                     └──────────────────────┘                 │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

- Other widgets dimmed (50% opacity)
- Focused widget highlighted with accent border
- Optional: zoom/enlarge focused widget
- All viewers see the same focus state

---

## Widget Cycling (TV Mode)

Auto-advance through widgets for unattended displays.

### Start Cycling

```javascript
// Cycle through all widgets
dashboard.presenter.startCycle({
  interval: 30,    // 30 seconds per widget
  loop: true       // Continuous loop
});

// Cycle through specific widgets
dashboard.presenter.startCycle({
  widgetIds: ['kpi-revenue', 'chart-trend', 'table-top'],
  interval: 60,
  loop: true
});

// Stop cycling
dashboard.presenter.stopCycle();
```

### Cycle Options

```typescript
interface CycleOptions {
  widgetIds?: string[];    // Widgets to cycle (default: all)
  interval?: number;       // Seconds per widget (default: 30)
  loop?: boolean;          // Loop continuously (default: true)
}
```

### Use Cases

| Scenario | Configuration |
|----------|---------------|
| **Office TV display** | All widgets, 30s interval, loop |
| **Executive summary** | KPIs + key charts, 60s interval |
| **Sales leaderboard** | Single table widget, no cycling |

---

## Timer

Meeting timer with countdown support.

### Timer Display

```javascript
// Get elapsed time
const elapsed = dashboard.presenter.timer.elapsed();
// Format: seconds since presentation started

// Get time remaining (if countdown set)
const remaining = dashboard.presenter.timer.remaining();
// Returns null if no countdown
```

### Timer Controls

```javascript
// Set countdown
dashboard.presenter.timer.setCountdown(1800);  // 30 minutes

// Pause during Q&A
dashboard.presenter.timer.pause();

// Resume
dashboard.presenter.timer.resume();

// Reset to start
dashboard.presenter.timer.reset();
```

### Timer Warnings

Visual indicators for time management:

| Remaining | Indicator |
|-----------|-----------|
| > 5 min | Green |
| 1-5 min | Yellow |
| < 1 min | Red (flashing) |

---

## Pointer

Virtual pointer visible to all viewers.

### Enable/Disable

```javascript
// Enable pointer
dashboard.presenter.pointer.enable();
// Cursor movement now synced to viewers

// Disable pointer
dashboard.presenter.pointer.disable();
```

### Position Updates

```javascript
// Track mouse position
dashboardElement.onmousemove = (e) => {
  if (dashboard.presenter.pointer.isEnabled?.()) {
    const rect = e.target.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    dashboard.presenter.pointer.move(x, y);
  }
};
```

### Viewer Rendering

```javascript
dashboard.presenter.subscribe(state => {
  if (state.pointer.enabled && state.pointer.position) {
    const { x, y } = state.pointer.position;
    pointerElement.style.left = `${x * 100}%`;
    pointerElement.style.top = `${y * 100}%`;
    pointerElement.style.display = 'block';
  } else {
    pointerElement.style.display = 'none';
  }
});
```

---

## Presentation State

Full state object:

```typescript
interface DashboardPresentationState {
  isPresenting: boolean;
  presenterId: string | null;
  presenterName: string | null;
  focusedWidgetId: string | null;
  startedAt: number | null;           // Unix timestamp

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

### Observing State

```javascript
dashboard.presenter.subscribe(state => {
  updateTimerDisplay(state);
  updateFocusIndicator(state.focusedWidgetId);

  if (state.countdown?.remaining < 60) {
    showTimeWarning();
  }

  if (state.cycling?.active) {
    showCycleProgress(state.cycling.currentIndex, state.cycling.widgetIds.length);
  }
});
```

---

## Viewer Sync

### Follow Protocol

Viewers automatically follow presenter:

```javascript
dashboard.presenter.subscribe(state => {
  if (!dashboard.presenter.isPresenter()) {
    // Follow focus
    if (state.focusedWidgetId) {
      highlightWidget(state.focusedWidgetId);
    } else {
      clearHighlight();
    }

    // Show pointer
    if (state.pointer.enabled) {
      renderPointer(state.pointer.position);
    }
  }
});
```

### Independent Viewing

Viewers can optionally browse independently:

```javascript
// Check if independent viewing is allowed
const meta = dashboard.meta.get();
if (meta.allowIndependentViewing) {
  showNavigationControls();
}
```

---

## Ending Presentation

```javascript
dashboard.presenter.stop();
// - Clears presentationState
// - Viewers return to normal view
// - Focus cleared
// - Cycling stopped
```

---

## Keyboard Shortcuts (Suggested)

| Key | Action |
|-----|--------|
| `→` `Space` | Next widget |
| `←` | Previous widget |
| `Home` | First widget |
| `End` | Last widget |
| `1-9` | Focus widget N |
| `P` | Toggle pointer |
| `C` | Toggle cycling |
| `F` | Clear focus (show all) |
| `Esc` | End presentation |

---

## Multiple Presenters

Only one presenter at a time. To transfer:

```javascript
// Current presenter stops
dashboard.presenter.stop();

// New presenter starts
await dashboard.presenter.start();
```

---

## Use Cases

### Executive Review

```javascript
await dashboard.presenter.start({
  countdown: 3600  // 1 hour
});

// Walk through KPIs one by one
dashboard.presenter.focusWidget('kpi-revenue');
// Discuss...
dashboard.presenter.nextWidget();  // 'kpi-growth'
// Discuss...
```

### TV Display

```javascript
await dashboard.presenter.start({
  hideFilters: true
});

dashboard.presenter.startCycle({
  interval: 30,
  loop: true
});

// Dashboard cycles indefinitely on office TV
```

### Board Meeting

```javascript
await dashboard.presenter.start({
  countdown: 1800,  // 30 minutes
  focusWidgetId: 'chart-quarterly-trend'
});

// Enable pointer for discussion
dashboard.presenter.pointer.enable();
```

---

## Implementation Notes

### Sync Latency

- Typical latency: 50-200ms
- Uses Y.js presence (ephemeral state)
- No persistence needed for presenter state

### Offline Handling

If presenter disconnects:
- Viewers stay on last synced state
- Reconnection resumes sync
- Presenter state persists in Y.js

### Data Refresh During Presentation

```javascript
// Data keeps refreshing by default
await dashboard.presenter.start({
  autoRefresh: true  // default
});

// Disable to freeze data during presentation
await dashboard.presenter.start({
  autoRefresh: false
});
```
