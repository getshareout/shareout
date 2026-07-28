---
title: Slides overview
description: Collaborative presentations with real-time editing, presenter mode, and version history built on ShareOut.
---

Slides is a presentation module built on ShareOut's infrastructure. Each deck is a live artifact with two URLs — one for editing, one for sharing — backed by a Y.js CRDT document.

## When to use Slides

| Situation | Why Slides fits |
| --- | --- |
| Team deck collaboration | Conflict-free real-time editing via Y.js |
| Sales or demo decks | Shareable published URL, no export step |
| Training or talks | Speaker notes, countdown timer, laser pointer |
| Data-heavy content | Free-form HTML canvas — embed any chart or widget |

For static documents without interactive data, a standard [published artifact](/guides/publishing/) may be simpler.

## Present this (AI deck)

Turn any published HTML page into a sibling **slides deck** — AI reads the
production HTML, builds a 5–9 slide reveal.js outline, and publishes a **new private
artifact** in the same workspace. Rate-limited per user; requires AI configured.

```http
POST /v1/artifacts/{id}/present
Authorization: Bearer {token}
```

Returns `{ "artifact_id", "url" }` for the new deck. The workspace assistant also
exposes a `present_artifact` tool. Open the result in Home like any other page —
edit in Slides or quick Edit mode, then publish when ready.

## Editor vs published URL

Every presentation has two artifacts created at the same time:

| Mode | URL | Access |
| --- | --- | --- |
| Editor | `shareout.site/a/{slug}` | Authenticated collaborators |
| Published | `shareout.site/p/{slug}` | Anyone (based on visibility) |

Changes in the editor propagate to the published view in real time over WebSocket — typical latency is 50–200 ms.

## Architecture

A presentation is a single Y.js document with five maps:

- `meta` — title, dimensions, fonts, colors, default transition
- `slides` — ordered array of slide metadata (id, owner, overrides, hidden, locked)
- `slideContent` — per-slide HTML as `Y.Text` for collaborative character-level sync
- `speakerNotes` — per-slide Markdown notes as `Y.Text`
- `presentationState` — live presenter state (current slide, laser position, countdown)

Media (images, video) is stored in [blobs](/sdk/blobs/) and referenced by blob ID from slide HTML.

## Quick start

```javascript
const sdk = new ShareOut();

// 1. Create a presentation
const { editorUrl, publishedUrl } = await sdk.slides.create({
  title: 'Q4 Review',
  aspectRatio: '16:9',
  visibility: 'public',
});

// 2. Open and add slides
const presentation = await sdk.slides.open('q4-review');
await presentation.connect();

const slide = presentation.slides.add();
presentation.slides.setContent(slide.id, '<h1>Q4 Results</h1>');

// 3. Observe real-time changes from collaborators
presentation.slides.observe(slides => renderSlideList(slides));
```

## Publishing a slides artifact

`sdk.slides.create()` calls `POST /v1/publish` internally and returns both artifact IDs. You do not publish slides through the standard publish endpoint — use `sdk.slides.create()` instead.

Visibility can be changed at any time:

```javascript
presentation.publish.setVisibility('public');   // 'private' | 'workspace' | 'public'
presentation.publish.unpublish();               // temporarily hide
presentation.publish.republish();               // restore
```

(`unlisted` is a retired legacy alias, still accepted on the API and treated as `public`.)

The shareable link is always the published URL:

```javascript
const url = presentation.publish.getUrl();
// https://shareout.site/p/q4-review
```

## Key features

- **Free-form HTML canvas** — each slide stores raw HTML; no element lock-in
- **Cascading metadata** — set fonts and colors once on the presentation; slides inherit unless they override
- **Per-slide ownership** — assign a user as owner of specific slides; lock to prevent other editors
- **Version history** — named snapshots plus automatic checkpoints; restore with one call
- **Presenter mode** — speaker view with notes, timer, laser pointer; audience follows automatically
- **AI generation** — `sdk.slides.generate({ prompt, theme })` creates a full deck from a prompt

## Next steps

- [Authoring decks](/slides/authoring/) — layout helpers, themes, create-with-content
- [SDK API reference](/slides/sdk-api/) — complete method signatures
- [Presenter mode](/slides/presenter-mode/) — speaker view, navigation, laser, versions
