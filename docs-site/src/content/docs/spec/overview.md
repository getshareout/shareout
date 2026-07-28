---
title: Artifact spec overview
description: What a ShareOut HTML artifact is and how the manifest model works.
---

A ShareOut artifact is a self-contained HTML file published to ShareOut and served at a
stable URL. The file owns its data: storage keys, table schemas, and realtime doc IDs are
all declared inside the file itself in a manifest block. The ShareOut SDK reads the manifest
to wire up persistence; the visual editor reads it to populate its data panel and autocomplete.

## What the spec requires

Every artifact must include four things:

| Element | Purpose |
|---------|---------|
| `<script type="shareout/manifest">` | Declares all data sources — required in `<head>` |
| `data-shareout-page` | Marks page containers — required on every page element |
| `data-shareout-binding` | Connects an element to a data value — required for all dynamic content |
| `data-shareout-template` | Marks repeating content driven by a table or JSON array |

Without the manifest the editor shows empty panels and offers no autocomplete. Without
`data-shareout-page` the outline navigation is blank. Without `data-shareout-binding` the
editor cannot track which values are in use.

Publishing is **never blocked** by spec gaps — artifacts go live regardless. Every HTML
publish returns an advisory `editor_readiness` profile (see [Publishing](/guides/publishing/))
that grades these markers and names what each gap disables in the studio.

## Attribute reference

| Attribute | Example value | Purpose |
|-----------|---------------|---------|
| `data-shareout-page` | `"dashboard"` | Page container ID |
| `data-shareout-page-title` | `"Dashboard"` | Display name in editor outline |
| `data-shareout-section` | `"kpis"` | Section within a page |
| `data-shareout-section-title` | `"Key Metrics"` | Section display name |
| `data-shareout-sortable` | _(present)_ or `"x"` | Enable drag-to-reorder in editor |
| `data-shareout-tabs` | `"views"` | Tab group container ID |
| `data-shareout-tab` | `"daily"` | Individual tab ID |
| `data-shareout-binding` | `"json:metrics.revenue"` | Data binding expression |
| `data-shareout-format` | `"currency"` | Display format |
| `data-shareout-editable` | `"true"` | Allow in-place editing |
| `data-shareout-template` | `"task-row"` | Template name for repeating items |
| `data-shareout-chart` | `'{"type":"line"}'` | Chart configuration JSON |
| `data-shareout-realtime` | `"board-sync"` | Realtime Y.js doc ID |
| `data-shareout-action` | `"navigate"` | Action type on interactive element |
| `data-shareout-if` | `"json:user.loggedIn = true"` | Conditional visibility |
| `data-shareout-nav` | `"main"` | Navigation container ID |
| `data-shareout-link` | `"page:dashboard"` | Navigation link target |

## Editor feature matrix

| Editor feature | What it needs | Missing consequence |
|----------------|---------------|---------------------|
| Data panel | Manifest `sources` | Empty panel |
| Autocomplete | Manifest `sources` | No suggestions |
| Mock preview | Manifest `default` on json, tables, and connections | Empty preview (no live fetch in studio) |
| Page outline | `data-shareout-page` | No outline |
| Section outline | `data-shareout-section` | Flat outline |
| Variable tracking | `data-shareout-binding` | Variables invisible |
| Template editing | `data-shareout-template` | Can't add/remove rows |
| Action diagram | `data-shareout-action` | No action visualization |

## Compliance checklist

Before publishing an artifact verify:

- `<script type="shareout/manifest">` exists in `<head>` with `"version": "2.0"`
- Every `sdk.json` key is declared in `sources.json`
- Every `sdk.table()` name is declared in `sources.tables`
- Every page element has `data-shareout-page`
- Every dynamic value has `data-shareout-binding`
- Repeating content uses `data-shareout-template`
- `default` sample data on json, table, and **connection** sources (live connectors preview from manifest defaults — no query in the studio)

## Related

- [Manifest](/spec/manifest/) — full manifest schema and field reference
- [Bindings](/spec/bindings/) — binding expression syntax and formats
- [Templates](/spec/templates/) — repeating content, charts, realtime
- [Pages](/spec/pages/) — page, section, tab, and navigation structure
- [JSON store](/sdk/json/) — `sdk.json` API
- [Tables](/sdk/tables/) — `sdk.table()` API
