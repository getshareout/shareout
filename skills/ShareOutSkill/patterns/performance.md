# Pattern: Fast rendering (instant first paint)

Goal: the artifact shows content — or at least its structure — immediately, never a blank screen, while data loads in the background.

## What the viewer already does for you

- The viewer wrapper streams a branded **loading skeleton instantly** (you get this for free — no code needed).
- Your artifact HTML streams from the CDN, so **static markup paints as it arrives**.
- `ShareOut.create()` returns immediately — it no longer blocks on the parent's `shareout:init` postMessage. The first `sdk.json` / `sdk.table()` read lazily awaits init and applies the server-seeded payload + session token before fetching, so private reads stay safe while static pages open fast.
- The SDK posts `shareout:content-ready` **automatically** once your data calls settle; the wrapper then removes the skeleton.

So you don't build a skeleton yourself. Your job is to make the moment *after* the skeleton fast and correct.

## Libraries load from the instance, not a public CDN

A chart library is the heaviest thing most artifacts load — `plotly.js-dist-min` is
~1.3 MB brotli — and pulling it from `cdn.plot.ly` puts a third DNS + TLS handshake on
the critical path, for bytes the instance can never cache.

ShareOut vendors the common libraries itself and serves them immutable + edge-cached:

```html
<script src="https://<instance>/vendor/plotly.js-dist-min@2.35.2/plotly.min.js"></script>
<script src="https://<instance>/vendor/d3@7/dist/d3.min.js" defer></script>
<link rel="stylesheet" href="https://<instance>/vendor/leaflet@1.9.4/dist/leaflet.css">
```

The path is `/vendor/<npm package>@<version>/<file inside the package>` — the same
layout jsDelivr uses, so any `cdn.jsdelivr.net/npm/…` URL translates by dropping the
host and `/npm`. Bytes are fetched once from jsDelivr, frozen in the instance's own
storage, and served from the host the viewer is already connected to.

**You don't have to remember this.** Publishing rewrites the URL shapes it can map
exactly — `cdn.plot.ly`, `d3js.org`, `cdn.jsdelivr.net/npm/…`, `unpkg.com/…` — to the
vendored path automatically. Writing `/vendor/…` yourself just skips the translation.

Anything outside the vendored set (`plotly.js*`, `d3`, `chart.js`, `echarts`,
`apexcharts`, `mermaid`, `lodash`, `dayjs`, `date-fns`, `luxon`, `papaparse`, `marked`,
`dompurify`, `katex`, `highlight.js`, `alpinejs`, `htmx.org`, `preact`, `react`,
`react-dom`, `vue`, `leaflet`, `three`, `gsap`, `zod`) keeps its CDN URL and the old
rules apply. A load-bearing chart library should still be **`defer`**-ed or placed at
the end of `<body>` — a synchronous `<script>` mid-page blocks everything after it.

## The three speed tiers of content

| Content | Speed | Guidance |
|---------|-------|----------|
| Static HTML (headings, labels, layout, copy) | **instant** — streams and paints | Put real structure/text in the markup, not empty `<div>`s filled by JS |
| `sdk.json` / `sdk.table()` | **instant** — server-prefetched and injected, no round-trip | First-paint data should come from here |
| `sdk.connection().query()` / live REST / dashboard `execute` | **1–3s** — live warehouse/API query | Never block first paint on these |

## Rules

1. **Ship real static HTML.** Headings, layout, labels, units, empty states — in the markup. The page should look like itself before any JS runs.
2. **First-paint data from `json`/`table`.** These are prefetched server-side and injected into the page, so `await sdk.json.get('snapshot')` resolves with **zero network round-trip**. Read a precomputed key.
3. **Don't run live queries on load.** `connection.query()` and dashboard `execute` hit the source live (1–3s). Precompute them into `sdk.json` (or a table) with a scheduled `query_snapshot` job or `conn.materialize(...)`, then read the snapshot. See [../sdk/connections.md](../sdk/connections.md), [../api/jobs.md](../api/jobs.md#querysnapshotconfig).
4. **Load in parallel, hydrate per section.** If you must fetch at runtime, `Promise.all` the calls and fill each section as its data arrives — don't `await` them one-by-one before rendering anything.
5. **Signal readiness when painted.** Call `ShareOut.ready()` after your render completes (tables drawn, charts mounted) to remove the skeleton at the exact right moment. If you omit it the SDK auto-detects readiness (network-idle); calling it is just crisper, especially for chart-heavy pages.

## Snapshot-first dashboard (fast)

```js
const sdk = await ShareOut.create();
// Instant: precomputed snapshot, injected by the server (no round-trip).
const s = (await sdk.json.get('snapshot')) || {};
renderTables(s);        // paint immediately
await mountCharts(s);   // draw charts
ShareOut.ready();       // hide the skeleton now that the page is painted
```

Refresh the `snapshot` key on a schedule with a `query_snapshot` job (deterministic SQL → json) so the live warehouse hit happens off the critical path. See [../agents/crew.md](../agents/crew.md).

## Live query on load (slow — avoid)

```js
const sdk = await ShareOut.create();
// 1–3s blank: the warehouse runs the query before anything renders.
const rows = await sdk.connection('warehouse').query('SELECT ...');
render(rows);
```

Use a live query only behind an explicit user action (a "Run" button), never for first paint. For always-fresh-on-load, materialize on a schedule and read the snapshot instead.

## Progressive hydration (independent sections)

```js
const sdk = await ShareOut.create();
renderShell();                     // static structure paints instantly
const [kpis, events] = await Promise.all([   // parallel, not sequential
  sdk.json.get('kpis'),
  sdk.table('events').query({ limit: 100 }),
]);
fillKpis(kpis); fillTable(events);
ShareOut.ready();
```

## Checklist

- [ ] Page structure (headings, layout, labels) is in the HTML, not built only by JS
- [ ] First-paint data reads from `sdk.json` / `sdk.table()`, not a live query
- [ ] Any live `connection.query()` is precomputed via `query_snapshot` / `materialize`, or gated behind a user action
- [ ] Runtime fetches run in parallel and hydrate per section
- [ ] `ShareOut.ready()` is called once the page is painted
- [ ] Library `<script>` tags point at `/vendor/…` (or a CDN shape publish can rewrite) and are `defer`-ed
