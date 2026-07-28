---
title: Fast rendering
description: Instant first paint for ShareOut artifacts — loading skeleton, prefetched data, and ShareOut.ready().
---

Goal: the artifact shows content — or at least its structure — immediately, never a
blank screen, while data loads in the background.

## What the viewer already does for you

- The viewer wrapper streams a branded **loading skeleton instantly** (free — no code).
- Your artifact HTML streams from the CDN, so **static markup paints as it arrives**.
- The SDK posts `shareout:content-ready` **automatically** once your data calls settle;
  the wrapper then removes the skeleton.

You don't build a skeleton yourself. Your job is to make the moment *after* the skeleton
fast and correct.

## The three speed tiers

| Content | Speed | Guidance |
| --- | --- | --- |
| Static HTML (headings, labels, layout, copy) | **Instant** — streams and paints | Put real structure/text in the markup, not empty `<div>`s filled by JS |
| `sdk.json` / `sdk.table()` | **Instant** — server-prefetched and injected | First-paint data should come from here |
| `sdk.connection().query()` / live REST | **1–3s** — live warehouse/API query | Never block first paint on these |

## Rules

1. **Ship real static HTML.** Headings, layout, labels, units, empty states — in the
   markup. The page should look like itself before any JS runs.
2. **First-paint data from `json`/`table`.** These are prefetched server-side and
   injected into the page, so `await sdk.json.get('snapshot')` resolves with **zero
   network round-trip**.
3. **Don't run live queries on load.** Precompute them into `sdk.json` (or a table) with
   a scheduled [`query_snapshot`](/guides/jobs/) job, then read the snapshot.
4. **Load in parallel, hydrate per section.** If you must fetch at runtime, use
   `Promise.all` and fill each section as its data arrives.
5. **Signal readiness when painted.** Call `ShareOut.ready()` after your render completes
   (tables drawn, charts mounted) to remove the skeleton at the exact right moment. If
   you omit it the SDK auto-detects readiness (network-idle); calling it is crisper on
   chart-heavy pages.

## Snapshot-first dashboard (fast)

```javascript
const sdk = await ShareOut.create();
// Instant: precomputed snapshot, injected by the server (no round-trip).
const s = (await sdk.json.get('snapshot')) || {};
renderTables(s);
await mountCharts(s);
ShareOut.ready();
```

Refresh the `snapshot` key on a schedule with a `query_snapshot` job so the live
warehouse hit happens off the critical path. See [Crew](/guides/crew/) for narrating
snapshots on a later cron.

## Live query on load (slow — avoid)

```javascript
const sdk = await ShareOut.create();
// 1–3s blank: the warehouse runs the query before anything renders.
const rows = await sdk.connection('warehouse').query('SELECT ...');
render(rows);
```

Use a live query only behind an explicit user action (a "Run" button), never for first
paint.

## Progressive hydration

```javascript
const sdk = await ShareOut.create();
renderShell(); // static structure paints instantly
const [kpis, events] = await Promise.all([
  sdk.json.get('kpis'),
  sdk.table('events').query({ limit: 100 }),
]);
fillKpis(kpis);
fillTable(events);
ShareOut.ready();
```

## Checklist

- Page structure (headings, layout, labels) is in the HTML, not built only by JS
- First-paint data reads from `sdk.json` / `sdk.table()`, not a live query
- Live `connection.query()` is precomputed via `query_snapshot`, or gated behind a user action
- Runtime fetches run in parallel and hydrate per section
- `ShareOut.ready()` is called once the page is painted

## Related

- [SDK overview](/sdk/overview/) — `ShareOut.create()`, `ShareOut.ready()`, `sdk.me()`
- [Scheduling jobs](/guides/jobs/) — `query_snapshot` for off-path warehouse refresh
- [Live data](/sdk/live-data/) — connection queries and the two-origin sandbox
