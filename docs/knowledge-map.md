# Knowledge map — design note

The Knowledge lens already lists what a workspace learned (tree/table of topics,
entities, pages). What it cannot do is show *how things connect* and *why we believe
a fact*. The map view adds that: search an entity, see its neighbourhood, read the
evidence behind every fact with a link to the page or file it came from.

## References — what we take, what we leave

| Product | Take | Leave |
|---|---|---|
| **Obsidian — local graph** | The *local* graph, not the global one: one focus node, a depth control (1 or 2 hops), filters that hide a whole kind at once. A graph of everything is a hairball; a graph around one thing is a map. | Physics simulation that never settles; nodes you cannot read until you hover. |
| **Neo4j Bloom** | Search-first entry ("type a name, land on a scene"), click-to-expand a node's neighbours, one colour per entity type with a legend that doubles as a filter. | Cypher, perspectives UI, a canvas you have to pan around before anything useful appears. |
| **Palantir Foundry — Object View** | The object page: properties on top, *linked objects grouped by link type* underneath, each a one-click hop. Provenance as a first-class column, not a tooltip. | Enterprise chrome, dozens of tabs, configuration before first use. |
| **Kumu — focus mode** | Select → focus: the 1–2-degree neighbourhood stays sharp, everything else recedes. Edge labels on demand (hover / selected), never all at once. | Decoration (gradients, glow), curved multi-edges. |
| **Linear / Notion — side peek** | Detail opens in a side panel beside the thing you clicked, URL-addressable, Esc to close, ⌘K-style search with keyboard navigation. Quiet chrome; whitespace; words before icons. | Nothing — this is the polish bar. |

Two smaller borrowings: an *evidence inspector* (SSKG Hub) where selecting a relation
shows the quoted sentence and its source, and the EclecticIQ *neighbourhood tab*
rule — cap what a single node expands to, most-mentioned first.

## Layout

Desktop (≥ 1100px), three columns inside the existing Knowledge lens, reached by a
new **Map** option on the Tree | Table toggle:

```
┌────────────────┬────────────────────────────────────┬──────────────────────┐
│ Search         │  breadcrumb: Workspace › Harbor Studio  │ Harbor Studio   Organization│
│ ─────────────  │                                    │ also: ML, Harbor Studio   │
│ ● All  43      │        ○ Metricly                  │ ──────────────────────│
│ ● Product 27   │     ○           ○ Lighthouse           │ Facts (2)             │
│ ● Project 20   │        ◉ Harbor Studio                  │  has live apps · 10   │
│ ● Org 13       │     ○           ○ Northwind              │   “10 live apps”      │
│ ○ Metric 11    │        ○                           │   ↗ Harbor Studio — Home   │
│ ─────────────  │                                    │ Connections (32)      │
│ Most mentioned │  depth ○1 ●2        ⤢ fit          │  part of ▸ Northwind, …     │
│  Harbor Studio  33  │                                    │  runs ▸ Lighthouse, …     │
│  Northwind       31  │  legend: ● Product ● Project …     │ Mentioned in (33)     │
│  Lighthouse    11  │                                    │  “…” — page › section │
└────────────────┴────────────────────────────────────┴──────────────────────┘
```

- **Left — find.** One search box (server-side, debounced, matches names and
  aliases), type chips with counts that filter both the list and the canvas, and
  the most-mentioned entities as a starting list. No empty canvas: the view opens on
  the most-mentioned entity.
- **Centre — neighbourhood.** The focus entity in the middle; direct neighbours on a
  ring, grouped by type so the clusters read; second-degree neighbours on an outer
  ring when depth = 2. Node size follows mention count; colour follows type (fixed
  order, validated for colour-vision deficiency, legend always visible). Edge
  labels show on hover and for the selected entity's edges. Click a node → it becomes
  the focus (breadcrumb grows, URL updates `#l/knowledge/map/<id>`). Drag to pan,
  wheel to zoom, "fit" resets. Layout is concentric, not a simulation: it settles
  instantly and the same entity always looks the same.
- **Right — evidence.** The entity panel: name, type, aliases; **Facts** each with
  its quote and a link to the source page/file; **Connections** grouped by relation
  type, each a hop; **Mentioned in** quotes with their locator. Links open the page
  in a Studio tab when it is a page, in a new tab when it is a file.

Mobile (< 860px): the three columns stack; the canvas keeps a 4:3 box and the panel
opens full-width with a back button, same as the tree view does today.

## Performance

The graph is never loaded whole. `GET /knowledge/graph?focus=&depth=&limit=` does the
breadth-first walk in the Durable Object (bounded by `limit`, most-mentioned first),
so the client lays out at most ~120 nodes. Concentric placement is O(n); a short
collision pass keeps labels apart. Search is server-side so 5k entities cost the
same as 300. Entity detail is one request, fetched on selection, cached per session.

## Bilingual

Every string goes through the home `t()` table (`copy/knowledge-map.ts`, en + es).
Relation types come from the extractor as snake_case English (`part_of`); the UI
shows them humanised (`part of`) and, for the dozen most common, translated.
Entity types (Organization, Product…) are translated the same way, with the raw
type as fallback so a new type never breaks the view.

## Not in this slice

Editing entities or relations, merging duplicates, time scrubbing over `validFrom`,
and a whole-workspace overview graph. All are compatible with this layout.
