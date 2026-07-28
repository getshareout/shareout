# Presenter Mode

Two-view presentation system with speaker controls and audience sync.

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PRESENTER                                   │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────┐              │
│  │   SPEAKER VIEW       │    │   CONTROLS           │              │
│  │                      │    │                      │              │
│  │  ┌────────────────┐  │    │  [◄ Prev] [Next ►]   │              │
│  │  │ Current Slide  │  │    │                      │              │
│  │  │                │  │    │  Timer: 05:23        │              │
│  │  └────────────────┘  │    │  Countdown: 24:37    │              │
│  │                      │    │                      │              │
│  │  ┌────────────────┐  │    │  [🔴 Laser]          │              │
│  │  │  Next Slide    │  │    │  [⬛ Blackout]       │              │
│  │  │  (thumbnail)   │  │    │                      │              │
│  │  └────────────────┘  │    │  Clock: 2:45 PM      │              │
│  │                      │    │                      │              │
│  │  ┌────────────────┐  │    │  Slide 5 of 12       │              │
│  │  │ Speaker Notes  │  │    │                      │              │
│  │  │ - Point A      │  │    │  [End Presentation]  │              │
│  │  │ - Point B      │  │    │                      │              │
│  │  └────────────────┘  │    └──────────────────────┘              │
│  └──────────────────────┘                                          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket sync
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         AUDIENCE VIEW                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │                    CURRENT SLIDE                            │   │
│  │                    (fullscreen)                             │   │
│  │                                                             │   │
│  │                         🔴 ← Laser pointer                  │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Starting a Presentation

```javascript
// Start presenting
await presentation.presenter.start({
  fromSlide: 0,           // Start from first slide
  countdown: 1800         // 30-minute countdown timer
});

// Opens speaker view (new window or panel)
// Audience views auto-sync to presenter
```

### Start Options

```typescript
interface StartOptions {
  fromSlide?: number;             // Starting slide index (default: 0)
  countdown?: number;             // Countdown timer in seconds
  autoAdvance?: boolean;          // Auto-advance slides
  autoAdvanceInterval?: number;   // Seconds between auto-advance
}
```

## Speaker View Components

### Current Slide

Live preview of what audience sees:

```javascript
// Speaker can click on current slide to advance
currentSlideElement.onclick = () => {
  presentation.presenter.next();
};
```

### Next Slide Thumbnail

Preview of upcoming slide for smooth transitions.

### Speaker Notes

Markdown-rendered notes for current slide:

```javascript
const notes = presentation.speakerNotes.get(currentSlideId);
notesPanel.innerHTML = renderMarkdown(notes.toString());
```

### Timer Display

```javascript
// Elapsed time
const elapsed = presentation.presenter.timer.elapsed();
// Format: "05:23"

// Time on current slide
const slideTime = presentation.presenter.timer.slideElapsed();

// Countdown remaining (if set)
const remaining = presentation.presenter.timer.remaining();
// Returns null if no countdown
```

### Timer Controls

```javascript
// Set 30-minute countdown
presentation.presenter.timer.setCountdown(1800);

// Pause during Q&A
presentation.presenter.timer.pause();

// Resume
presentation.presenter.timer.resume();

// Reset to start
presentation.presenter.timer.reset();
```

### Timer Warnings

Visual indicators for time management:

| Remaining | Indicator |
|-----------|-----------|
| > 5 min | Green |
| 1-5 min | Yellow |
| < 1 min | Red (flashing) |

### Clock

Real-time clock for schedule awareness.

### Slide Navigator

Quick-jump to any slide:

```javascript
presentation.presenter.goToSlide(7);
```

Thumbnail strip shows all slides with current highlighted.

---

## Laser Pointer

Virtual pointer visible to audience.

### Enable/Disable

```javascript
presentation.presenter.laser.enable();
// Cursor over current slide now shows as laser

presentation.presenter.laser.disable();
```

### Position Updates

```javascript
// Track mouse position on speaker view
currentSlideElement.onmousemove = (e) => {
  if (presentation.presenter.laser.isEnabled()) {
    const rect = e.target.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    presentation.presenter.laser.move(x, y);
  }
};
```

### Audience Rendering

```javascript
presentation.presenter.subscribe(state => {
  if (state.laser.enabled && state.laser.position) {
    const { x, y } = state.laser.position;
    laserElement.style.left = `${x * 100}%`;
    laserElement.style.top = `${y * 100}%`;
    laserElement.style.display = 'block';
  } else {
    laserElement.style.display = 'none';
  }
});
```

---

## Navigation Controls

### Basic Navigation

```javascript
presentation.presenter.next();
presentation.presenter.previous();
presentation.presenter.first();
presentation.presenter.last();
presentation.presenter.goToSlide(index);
```

### Keyboard Shortcuts (Suggested)

| Key | Action |
|-----|--------|
| `→` `Space` `Enter` | Next slide |
| `←` `Backspace` | Previous slide |
| `Home` | First slide |
| `End` | Last slide |
| `1-9` | Jump to slide N |
| `L` | Toggle laser |
| `B` | Blackout screen |
| `Esc` | End presentation |

### Hidden Slides

Slides with `hidden: true` are skipped during navigation:

```javascript
// Skip hidden slides automatically
presentation.presenter.next();  // Jumps over hidden slides
```

---

## Audience View

### Sync Protocol

Audience subscribes to presenter state via presence:

```javascript
presentation.presenter.subscribe(state => {
  // Follow presenter's current slide
  if (!presentation.presenter.isPresenter()) {
    goToSlide(state.currentSlideIndex);

    // Show laser if enabled
    if (state.laser.enabled && state.laser.position) {
      renderLaser(state.laser.position);
    }
  }
});
```

### Fullscreen Mode

```javascript
// Enter fullscreen
audienceContainer.requestFullscreen();

// Exit on Esc
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    // Exited fullscreen
  }
});
```

### Optional Self-Navigation

Presenter can allow audience to navigate independently:

```javascript
// In presenter settings
presentation.meta.set({
  allowAudienceNavigation: true
});
```

When enabled, audience sees subtle navigation controls.

---

## Blackout Mode

Temporarily hide content:

```javascript
presentation.presenter.blackout(true);   // Show black screen
presentation.presenter.blackout(false);  // Resume

// Audience sees black screen
// Useful for: breaks, discussions, Q&A
```

---

## Presentation State

Full state object:

```typescript
interface PresentationState {
  isPresenting: boolean;
  presenterId: string | null;
  presenterName: string | null;
  currentSlideIndex: number;
  totalSlides: number;
  startedAt: number | null;           // Unix timestamp
  slideStartedAt: number | null;

  countdown: {
    total: number;
    remaining: number;
    paused: boolean;
  } | null;

  laser: {
    enabled: boolean;
    position: { x: number; y: number } | null;
  };

  blackout: boolean;
}
```

### Observing State

```javascript
presentation.presenter.subscribe(state => {
  updateTimerDisplay(state);
  updateSlideIndicator(state.currentSlideIndex, state.totalSlides);

  if (state.countdown?.remaining < 60) {
    showTimeWarning();
  }
});
```

---

## Ending Presentation

```javascript
presentation.presenter.stop();
// - Clears presentationState
// - Audience returns to normal view
// - Timer data saved to timings
```

---

## Multiple Presenters

Only one presenter at a time. To transfer:

```javascript
// Current presenter stops
presentation.presenter.stop();

// New presenter starts
await presentation.presenter.start();
```

---

## Analytics (Future)

Track presentation metrics:

```javascript
// After presentation ends
const metrics = presentation.presenter.getMetrics();
// {
//   totalDuration: 1523,
//   slideDurations: { 'slide-1': 45, 'slide-2': 120, ... },
//   slideVisits: { 'slide-1': 2, 'slide-3': 3, ... }
// }
```

---

## Implementation Notes

### Speaker View Window

Can be:
1. Separate browser window (`window.open`)
2. Panel in same window (split view)
3. Secondary display (if detected)

### Sync Latency

- Typical latency: 50-200ms
- Uses Y.js presence (ephemeral state)
- No persistence needed for presenter state

### Offline Handling

If presenter disconnects:
- Audience stays on last synced slide
- Reconnection resumes sync
- Presenter state persists in Y.js
