---
title: Presenter mode
description: Speaker view, navigation, laser pointer, timers, and audience sync for ShareOut Slides.
---

Presenter mode provides a two-view system: the presenter gets a speaker view with notes, timers, and navigation controls; the audience sees the current slide in sync. Only one presenter can be active at a time.

## Starting a presentation

```javascript
await presentation.presenter.start({
  fromSlide: 0,       // slide index (default: 0)
  countdown: 1800,    // 30-minute countdown in seconds (optional)
});
```

Full options:

```typescript
interface StartOptions {
  fromSlide?: number;
  countdown?: number;
  autoAdvance?: boolean;
  autoAdvanceInterval?: number;  // seconds between auto-advances
}
```

Calling `start()` sets `presentationState.isPresenting = true` in the Y.js document. All connected clients receive the update immediately.

## Navigation

```javascript
presentation.presenter.next();
presentation.presenter.previous();
presentation.presenter.first();
presentation.presenter.last();
presentation.presenter.goToSlide(5);   // zero-based index
```

Slides with `hidden: true` are skipped automatically during `next()` and `previous()`.

Suggested keyboard bindings for a custom speaker UI:

| Key | Action |
| --- | --- |
| `→` `Space` `Enter` | Next slide |
| `←` `Backspace` | Previous slide |
| `Home` | First slide |
| `End` | Last slide |
| `L` | Toggle laser |
| `B` | Toggle blackout |
| `Esc` | End presentation |

## Speaker view

The speaker view typically shows: current slide preview, next slide thumbnail, speaker notes, timer, and slide count. Build it from the state returned by `subscribe()`:

```javascript
presentation.presenter.subscribe(state => {
  updateSlideCounter(state.currentSlideIndex, state.totalSlides);
  updateTimer(state);
  if (state.countdown) {
    const { remaining } = state.countdown;
    setTimerColor(remaining > 300 ? 'green' : remaining > 60 ? 'yellow' : 'red');
  }
});
```

### Reading speaker notes

Notes are Markdown. Render them in the speaker panel for the current slide:

```javascript
const currentSlideId = presentation.slides.list()[state.currentSlideIndex]?.id;
const notes = presentation.speakerNotes.get(currentSlideId);
notesPanel.innerHTML = renderMarkdown(notes.toString());

notes.observe(() => {
  notesPanel.innerHTML = renderMarkdown(notes.toString());
});
```

## Timer

```typescript
timer.elapsed(): number              // seconds since presentation started
timer.slideElapsed(): number         // seconds on current slide
timer.setCountdown(seconds: number): void
timer.remaining(): number | null     // null if no countdown set
timer.pause(): void
timer.resume(): void
timer.reset(): void
```

Example — display a live clock and countdown:

```javascript
setInterval(() => {
  const elapsed = presentation.presenter.timer.elapsed();
  const remaining = presentation.presenter.timer.remaining();

  elapsedEl.textContent = formatSeconds(elapsed);
  if (remaining !== null) countdownEl.textContent = formatSeconds(remaining);
}, 1000);
```

Timer color conventions:

| Remaining | Indicator |
| --- | --- |
| > 5 min | Green |
| 1–5 min | Yellow |
| < 1 min | Red (flashing) |

## Laser pointer

The laser position is broadcast to all audience clients as normalized coordinates (0–1).

```javascript
// Enable laser
presentation.presenter.laser.enable();

// Track mouse on the speaker's current-slide element
currentSlideEl.onmousemove = (e) => {
  if (!presentation.presenter.laser.isEnabled()) return;
  const rect = currentSlideEl.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  presentation.presenter.laser.move(x, y);
};

// Disable
presentation.presenter.laser.disable();
```

Rendering on the audience side:

```javascript
presentation.presenter.subscribe(state => {
  if (state.laser.enabled && state.laser.position) {
    const { x, y } = state.laser.position;
    laserEl.style.left = `${x * 100}%`;
    laserEl.style.top = `${y * 100}%`;
    laserEl.style.display = 'block';
  } else {
    laserEl.style.display = 'none';
  }
});
```

## Blackout

Temporarily hide the audience's view (useful for breaks or Q&A):

```javascript
presentation.presenter.blackout(true);    // audience sees black screen
presentation.presenter.blackout(false);   // resume
```

## Audience sync

Audience clients subscribe to presenter state and follow the current slide. They do not need to call `start()`:

```javascript
presentation.presenter.subscribe(state => {
  if (!presentation.presenter.isPresenter()) {
    goToSlide(state.currentSlideIndex);
    renderLaser(state.laser);
    if (state.blackout) showBlackout();
  }
});
```

To check whether anyone is currently presenting:

```javascript
presentation.presenter.isActive();      // true if presentation is running
presentation.presenter.isPresenter();   // true if this client is the presenter
```

### Optional audience self-navigation

If no one is presenting, or if the presenter enables it, viewers can navigate independently:

```javascript
// Set on the presentation to allow audience navigation
presentation.meta.set({ allowAudienceNavigation: true });
```

## Stopping a presentation

```javascript
presentation.presenter.stop();
// Clears presentationState.isPresenting
// Audience returns to normal view
// Per-slide timing data is saved to the timings map
```

## Transferring presenter control

Only one user can present at a time. To hand off:

```javascript
// Current presenter
presentation.presenter.stop();

// New presenter (separate client)
await presentation.presenter.start();
```

## State reference

Full state object returned by `presenter.state()` and `presenter.subscribe()`:

```typescript
interface PresentationState {
  isPresenting: boolean;
  presenterId: string | null;
  presenterName: string | null;
  currentSlideIndex: number;
  totalSlides: number;
  startedAt: number | null;        // unix timestamp ms
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

## Version history

Create a named version before a presentation to make rollback safe:

```javascript
await presentation.versions.create('Before board meeting', 'Pre-presentation backup');
```

After presenting, compare what changed:

```javascript
const diff = await presentation.versions.diff('ver_before', 'ver_after');
console.log(`${diff.slides.modified.length} slides changed`);
```

Full versions API:

```typescript
versions.list(): Promise<Version[]>
versions.create(name: string, description?: string): Promise<Version>
versions.restore(versionId: string): Promise<void>    // auto-saves current state first
versions.diff(fromId: string, toId: string): Promise<VersionDiff>
versions.delete(versionId: string): Promise<boolean>
versions.subscribe(handler: (versions: Version[]) => void): () => void
```

Auto-saves trigger: every 5 minutes if changes exist, before a presentation starts, and when the last editor disconnects. The 10 most recent auto-saves are retained; named versions are never auto-deleted.

## Permissions

| Role | Can present | Can view published | Can edit |
| --- | --- | --- | --- |
| `owner` | Yes | Yes | Yes |
| `editor` | Yes | Yes | Yes |
| `viewer` | No | Yes | No |
| Anonymous | No | Based on visibility | No |

Manage collaborators via `sdk.collaborators`:

```javascript
await sdk.collaborators.add(['colleague@example.com'], 'editor');
await sdk.collaborators.add(['stakeholder@example.com'], 'viewer');
```

## Publishing the shareable link

The published URL (`shareout.site/p/{slug}`) is always available to the audience. Control visibility and embedding:

```javascript
presentation.publish.setVisibility('public');  // 'private' | 'workspace' | 'public'
const url = presentation.publish.getUrl();
```

Embed in an external page:

```html
<iframe src="https://shareout.site/embed/my-deck/" width="100%" height="600" frameborder="0"></iframe>
```

Embedding is available for `public` presentations. Restrict to specific origins via `PATCH /v1/artifacts/{id}` with `embed_origins`.

(`unlisted` is a retired legacy alias, still accepted on the API and treated as `public`.)
