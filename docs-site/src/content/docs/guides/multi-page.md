---
title: Multi-page artifacts
description: Publish a small site — several HTML files in one artifact — with links that stay inside it and a URL for every page.
---

An artifact can hold more than one HTML file. A handbook, a microsite or a report with
appendices can ship as one artifact: one link to share, one version history, and each
page still has its own URL.

## Build one

Publish an `index.html` (the entrypoint) plus the other pages as sibling files, in
folders if you like:

```json
{
  "name": "Acme handbook",
  "slug": "acme-handbook",
  "entrypoint": "index.html",
  "files": [
    { "path": "index.html", "content": "<a href=\"procedures/intake.html\">Intake</a> <a href=\"procedures/billing.html\">Billing</a>" },
    { "path": "procedures/intake.html", "content": "<a href=\"../index.html\">Back to the handbook</a>" },
    { "path": "procedures/billing.html", "content": "<a href=\"intake.html\">Intake</a>" }
  ]
}
```

Link between pages with **relative** hrefs (`procedures/intake.html`, `../index.html`),
the same way you would on any static site. Shared CSS, JS and images work the same way.

## How links behave

| Link | What happens |
| --- | --- |
| Relative link to another page | Opens that page inside the artifact |
| Absolute link to the same artifact (`/a/acme-handbook/…` or the full URL) | Rerouted to open inside the artifact, not as a viewer inside the viewer |
| Link to a different artifact | Opens it in its own tab on Home, or a new browser tab elsewhere |
| Cmd/Ctrl/Shift-click, or a `download` link | Left to the browser |

This also covers menus that are built with JavaScript.

## Deep links to a page

The address bar follows the page being shown, so a copied link opens that page:

| Where | URL |
| --- | --- |
| Artifact viewer | `/a/acme-handbook/?page=procedures/intake.html` |
| Home | `#a/acme-handbook/procedures/intake.html` |

Browser back and forward move between pages as you'd expect. `?page=` only accepts HTML
files of the live version.

## Pages list in Details

When an artifact has two or more HTML pages, **Details** on Home shows **Pages (N)**.
Pick one to show it; the link in the address bar then opens that page.

## Single-file alternative

For an app-like artifact with views inside **one** HTML file, use
`data-shareout-page` sections instead. See [Pages, sections & navigation](/spec/pages/).
Both approaches can be combined.

## Related

- [Publishing artifacts](/guides/publishing/)
- [Version history & restore](/everyone/version-history/)
