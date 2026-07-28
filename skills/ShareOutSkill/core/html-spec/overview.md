# ShareOut HTML Specification v2.0 - Overview

> **MANDATORY SPECIFICATION — ALL SHAREOUT ARTIFACTS MUST COMPLY**

## Why This Matters

The ShareOut Live Editor cannot guess your data structure. It needs explicit declarations to provide:
- Data panel with all sources
- Autocomplete for bindings
- Page/section outline navigation
- Template editing (add/remove items)
- Chart data binding
- Real-time collaboration indicators

**Without the spec → Editor shows empty panels, no autocomplete, no outline, degraded experience.**

## Quick Reference

### Required Elements

| Element | Purpose | Location |
|---------|---------|----------|
| `<script type="shareout/manifest">` | Data source declaration | `<head>` |
| `data-shareout-page` | Page container | Any element |
| `data-shareout-section` | Section within page | Inside page |
| `data-shareout-binding` | Data binding | Any element |

### Attribute Quick Reference

| Attribute | Values | Example |
|-----------|--------|---------|
| `data-shareout-page` | Page ID | `data-shareout-page="dashboard"` |
| `data-shareout-page-title` | Display name | `data-shareout-page-title="Dashboard"` |
| `data-shareout-section` | Section ID | `data-shareout-section="kpis"` |
| `data-shareout-section-title` | Display name | `data-shareout-section-title="Key Metrics"` |
| `data-shareout-sortable` | Editor: children drag-reorder | `data-shareout-sortable` or `="x"` for rows |
| `data-shareout-tabs` | Tab group ID | `data-shareout-tabs="views"` |
| `data-shareout-tab` | Tab ID | `data-shareout-tab="daily"` |
| `data-shareout-binding` | Binding expression | `data-shareout-binding="json:metrics.revenue"` |
| `data-shareout-format` | Format type | `data-shareout-format="currency"` |
| `data-shareout-editable` | Enable editing | `data-shareout-editable="true"` |
| `data-shareout-template` | Template name | `data-shareout-template="task-row"` |
| `data-shareout-chart` | Chart config JSON | `data-shareout-chart='{"type":"line"}'` |
| `data-shareout-realtime` | Realtime doc ID | `data-shareout-realtime="board-sync"` |
| `data-shareout-action` | Action type | `data-shareout-action="navigate"` |
| `data-shareout-if` | Show when true | `data-shareout-if="json:user.loggedIn = true"` |
| `data-shareout-form` | Form ID | `data-shareout-form="contact"` |
| `data-shareout-nav` | Nav container ID | `data-shareout-nav="main"` |
| `data-shareout-link` | Link target | `data-shareout-link="page:dashboard"` |

## Compliance Checklist

Before generating any ShareOut artifact, verify ALL of these:

### Manifest
- [ ] `<script type="shareout/manifest">` exists in `<head>`
- [ ] ALL `sdk.json` keys declared in `manifest.sources.json`
- [ ] ALL `sdk.table()` names declared in `manifest.sources.tables`

### Structure
- [ ] ALL pages use `data-shareout-page` attribute
- [ ] ALL sections use `data-shareout-section` attribute
- [ ] ALL tabs use `data-shareout-tab` within `data-shareout-tabs`

### Bindings
- [ ] ALL dynamic content uses `data-shareout-binding` attributes
- [ ] NO DOM updates via JS without corresponding binding attributes
- [ ] ALL repeating content uses `data-shareout-template`

### Actions
- [ ] ALL interactive elements have `data-shareout-action` or `data-shareout-link`
- [ ] ALL actions have `data-shareout-action-display` labels

## Editor Feature Matrix

| Editor Feature | Required Attribute | Consequence if Missing |
|----------------|-------------------|------------------------|
| Data Panel | Manifest `sources` | Empty data panel |
| Autocomplete | Manifest `sources` | No suggestions |
| Mock Preview | Manifest `default` values | No preview data |
| Page Outline | `data-shareout-page` | No outline navigation |
| Section Outline | `data-shareout-section` | Flat outline |
| Variable Detection | `data-shareout-binding` | Variables not tracked |
| Template Editing | `data-shareout-template` | Can't add/remove items |
| Action Flow Diagram | `data-shareout-action` | No action visualization |

## Related Files

- [Visual Editor (Live Studio)](../../core/editor.md) — `/a/{slug}/edit` studio, Agent/Inspect/Data rail
- [Manifest Structure](manifest.md) - Data source declarations
- [Bindings](bindings.md) - Binding syntax and formats
- [Templates](templates.md) - Repeating content and charts
- [Pages](pages.md) - Page/section/tab structure
- [UI / styling](../../modules/ui/overview.md) - Brand styling with `.so-` classes (safe in the editor; layers onto these attributes)

> **Styling vs. structure:** the `data-shareout-*` attributes above are what the editor reads. Visual styling is separate — link `shareout.css` and use `.so-` classes ([modules/ui/](../../modules/ui/overview.md)). External CSS/JS and custom classes are preserved through editor saves; they never replace the attributes here.

---

**Version:** 2.1.0
**Status:** MANDATORY
