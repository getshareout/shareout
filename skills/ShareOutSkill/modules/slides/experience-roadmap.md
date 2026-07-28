# ShareOut Slides — Presentation Experience Roadmap

Making the *act of presenting and collaborating* best-in-class. This is the feature roadmap for the live experience — speaker mode, timing, notes, audience engagement, and real collaborative editing — covering both **improving what we already have** and **adding what's missing**.

> Companion to [b2b-expansion.md](./b2b-expansion.md) (monetization/analytics). This doc is about the craft of the product itself.
>
> Grounded in the **current** build: D1 + `broadcastEvent` ([presenter.ts](../../../shareout-app/src/data/slides/presenter.ts)), basic `window.open` presenter popup ([editor/presentation/index.ts:336](../../../shareout-app/src/editor/presentation/index.ts#L336)). The Y.js CRDT in [overview.md](./overview.md) is **designed but not built** — collaboration today is broadcast-based.

## Where we are honestly

| Area | Have | Reality |
|---|---|---|
| Presenter state (slide/timer/laser/countdown) | ✅ server-synced | solid backend in `presenter.ts` |
| Speaker view | ⚠️ | bare `window.open` popup — current slide iframe, next-as-text, notes-as-text, one wall-clock timer |
| Speaker notes | ⚠️ | plain `<textarea>`, plain text |
| Timing | ⚠️ | single elapsed clock + one global countdown |
| Audience sync | ✅ basic | follows presenter slide + laser via broadcast |
| Collaborative editing | ❌ | broadcast events, no CRDT, no live cursors, no merge |
| Per-slide ownership / locking | ✅ data only | columns exist in DB, no UI/enforcement surfaced |
| Q&A / reactions / polls / annotation | ❌ | none |

The backend is further along than the experience. **The gap is the front-of-room UX and real collaboration.**

---

## 1. Speaker Mode — rebuild as a real cockpit

Replace the popup with a proper speaker view (separate window or second display). This is the single most visible upgrade.

**Improve (exists, weak):**
- Current slide **live preview** (synced, not a static iframe write)
- **Next slide thumbnail** rendered (currently just the title as text)
- Notes panel (see §3)

**Add (missing):**
- **Slide navigator strip** — thumbnails, click-to-jump, shows hidden/skipped
- **Clock + multiple timers** side by side (see §2)
- **Presenter toolbar**: laser toggle, blackout, pointer/annotation, "next up" speaker
- **Keyboard map overlay** (`?`) — arrows/space/Home/End/1-9/L/B/Esc
- **Connection/audience indicator** — "12 watching · 2 following you live"
- **Confidence monitor** option — mirror of audience view with overlays

## 2. Timing & per-speaker budgets

Today: one elapsed clock + one global countdown. B2B decks are often **multi-presenter** (sales + SE + exec). Make timing first-class.

**Add:**
- **Per-slide target durations** — set a budget per slide; speaker view shows pace ("on slide 4 of 20 · 2:10 used of 1:30 target" in red when over)
- **Per-speaker segments & handoff** — assign slide ranges to named presenters, each with a time budget; visible "↳ hand off to Dana at slide 12" cue; auto-switch presenter control on handoff
- **Pacing bar** — green/amber/red against the planned timeline, so a presenter sees at a glance if they're ahead/behind
- **Rehearsal mode** — present privately, record per-slide timings, then a report: "ran 3:40 over · slowest: slide 7 (4:12) · cut ~2 slides." Feeds target durations back automatically.
- **Auto-advance presets** — per-slide dwell for kiosk/loop mode

Backend already stores `countdown_*` and `slide_started_at` per `presentation_state`; extend with a `slide_timings` table (target + actual + presenter assignment).

## 3. Speaker notes — from textarea to teleprompter

**Improve:**
- **Rich notes** (markdown → rendered): headings, bold, bullets, links
- Bigger, adjustable font; high-contrast reading layout

**Add:**
- **Teleprompter / scroll mode** — auto-scroll at reading pace, large type, mirror option
- **Inline cues** — `[pause]`, `[click]`, `[demo]` markers that surface as chips in speaker view
- **Per-speaker notes** — notes scoped to whoever owns the segment
- **AI talking points** (optional) — generate/expand notes from slide content

## 4. Audience engagement — make viewing interactive

Right now the audience passively follows. Add two-way:

- **Reactions** — lightweight emoji/applause that float on the presenter's view (live pulse of the room)
- **Q&A queue** — audience submits questions, presenter sees/dismisses/marks-answered in speaker view; upvoting
- **Live polls** — presenter pushes a poll slide, results render in real time
- **Live annotation / pen** — draw on the current slide for everyone (beyond the existing laser dot)
- **Blackout** (spec'd, finish it) — `B` to hide for breaks/Q&A
- **Self-navigation toggle** — let audience browse independently while still showing "presenter is on slide 8" — already implied by state, needs the UI + an `allow_audience_nav` flag

All of these ride the existing `broadcastEvent` channel — no CRDT dependency.

## 5. Collaborative editing — the real one

This is the biggest *build*, and the largest gap between [overview.md](./overview.md)'s promise and reality.

**Improve (data exists, surface it):**
- **Per-slide ownership & locking** — columns `owner_id` / `locked` already in `slides` ([db.ts:22](../../../shareout-app/src/data/slides/db.ts#L22)); add the UI (claim/lock/unlock) and enforce on edit
- **Presence** — "who's here, who's on which slide"

**Add:**
- **Y.js CRDT migration** — replace broadcast-merge with conflict-free co-editing (the documented architecture). Enables true simultaneous editing.
- **Live cursors & selections** — see collaborators' carets/selections in real time
- **Comments & threads on slides** — review workflow ("@dana fix this stat"), resolve/reopen
- **Suggestion / review mode** — propose edits without committing, owner accepts

Sequence CRDT carefully: it underpins live cursors, comments, and simultaneous editing, but **none of §1–§4 depend on it** — ship those first.

## 6. SDK & authoring — richer creation primitives

Today the authoring API is **low-level**. `slides.create()` takes metadata only ([index.ts:147](../../../shareout-app/sdk/src/stores/slides/index.ts#L147)); slides are built by writing **raw HTML** into `setContent()`; helpers cover content primitives + a few layouts (`textBlock`, `heading`, `bulletList`, `image`, `codeBlock`, `bigNumber`, `quote`, `twoColumn`, `centered`) in [slide-helpers.ts](../../../shareout-app/sdk/src/presentation/slide-helpers.ts) — but there's no theme cascade, no data components, no full-slide layouts, and no way to build a deck in one call. Anyone generating a deck programmatically (or via an AI agent) still hand-assembles HTML. That's the friction to remove. See [sdk-authoring-spec.md](./sdk-authoring-spec.md) for the concrete API.

**Improve (exists, thin):**
- **Create-with-content** — let `create()` accept slides inline (array of slides, or a markdown/outline string) so a deck is one call, not create-then-N-adds
- **Bulk slide ops** — `addMany()`, `replaceAll()`, reorder-by-id; today it's one `add()` at a time

**Add — layout & component helpers** (encode the patterns already in [design/](./design/)):
- **Layout helpers** as first-class: `helpers.titleSlide()`, `twoColumn()`, `imageText()`, `bigNumber()`, `quote()`, `cards()`, `sectionDivider()` — so callers pick a layout instead of writing flex/grid CSS
- **Data components**: `chart(data, type)` (data-driven, not an image), `table(rows)`, `metric()`, `icon()`, `embed()`, `video()`
- **Asset helpers** — push images/video through ShareOut blobs and get back a ready `<img>`/`<video>`; today `image()` only takes a URL

**Add — themes & templates (SDK-level):**
- **Theme system** — apply a named theme (`dark-professional`, `pitch-deck`, etc. from [design/](./design/)) that cascades fonts/colors; the `template` column exists in the DB but nothing consumes it
- **Master layouts / sections** — reusable slide layouts and section grouping, so a 40-slide deck stays consistent
- **Component-level styling** that respects `defaultColors`/`defaultFonts` cascade instead of inline hardcoding

**Add — import / export:**
- **Import**: from markdown, from an outline, from PPTX/Google Slides, from PDF
- **Export**: deck → PDF, deck → standalone HTML, single slide → PNG (also unblocks thumbnails for the navigator in §1 and analytics in [b2b-expansion.md](./b2b-expansion.md))

**Add — AI authoring:**
- **`generate(prompt)`** — deck from a prompt (outline → slides → styled with a theme)
- **Per-slide AI** — `rewrite()`, `expand()`, `suggestLayout()`, generate speaker notes (ties to §3)
- This is the natural fit for ShareOut's agent story — an agent builds a real deck without touching raw HTML

Most of this is **pure SDK + helper work, no backend change** — the layout/component/theme helpers are client-side HTML generation. Import/export and AI need supporting endpoints.

---

## Suggested sequencing

Two parallel tracks — **live experience** and **authoring** — that don't block each other:

**Live experience track:**
1. **Speaker Mode rebuild (§1)** + **rich notes (§3)** — highest visible impact, no CRDT needed. The "wow" in a demo.
2. **Per-speaker timing & rehearsal (§2)** — differentiator vs. Google Slides/PowerPoint; backend is half-there.
3. **Audience engagement (§4)** — reactions → Q&A → polls, all on existing transport.
4. **Collaboration (§5)** — surface ownership/locking UI now; schedule the Y.js migration as its own track since it's the heaviest lift.

**Authoring track (§6), parallel:**
1. **Layout + component helpers** + **create-with-content** — pure SDK, removes the raw-HTML friction immediately.
2. **Theme system + export-to-PNG** — also unblocks thumbnails for §1 and analytics.
3. **AI authoring + import/export** — the agent-driven deck story.

Live phases 1–3 and the whole authoring track need no architectural change. Collaboration phase 4 is where the CRDT investment lands.

## Open questions

- **Second-screen vs. window** for speaker view — Presentation API (`requestPresentation`) for real dual-display, or stay window-based?
- **Per-speaker identity** — tie segment assignment to collaborators (real users) or freeform labels?
- **CRDT timing** — do we need simultaneous editing now, or is broadcast + locking good enough until paid collaboration demand is proven?
- **Authoring model** — keep raw-HTML-with-helpers (max flexibility), or introduce an optional structured block model that layouts/AI/import target? Affects export and theming.
- Which track (live experience §1–§5 or authoring §6) do you want speced to implementation detail first?
