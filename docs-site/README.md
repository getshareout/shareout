# ShareOut Docs

Developer & customer documentation for ShareOut, built with
[Starlight](https://starlight.astro.build) (Astro). The REST API reference is
generated from an OpenAPI spec via
[`starlight-openapi`](https://starlight-openapi.vercel.app).

Themed with the ShareOut design system — see `../Design/`.

## Making these docs your own

This site ships with the repo so a self-hosted instance has real documentation on
day one. It is an ordinary Astro project — nothing in the Worker depends on it:

1. **Edit content** — Markdown/MDX under `src/content/docs/`. Add a file, it becomes
   a page; sidebar groups are configured in `astro.config.mjs`.
2. **Retheme** — `src/styles/shareout.css` maps design tokens onto Starlight
   variables. Swap the logo in `src/assets/` and the title/`site` in
   `astro.config.mjs`.
3. **Trim** — delete the pages you do not want (the `self-host/` section is the one
   your users probably do not need). The API reference regenerates from
   `src/openapi/shareout.yaml`, so edit or replace the spec rather than the
   generated pages.
4. **Deploy anywhere** — `npm run build` emits a static `dist/`. Host it on
   Cloudflare Pages, Vercel, S3, GitHub Pages, whatever. To serve it from a
   hostname the Worker owns (e.g. `docs.example.com`), set `DOCS_HOST` and
   `DOCS_ORIGIN` in the Worker's vars and it proxies through; leave them unset and
   the Worker ignores docs entirely.

Or delete `docs-site/` outright — the product does not import from it.

## Structure

```
src/
├── assets/shareout-mark.png     Brand mark (cropped from Design/brand-art/shareout_logo.png)
├── content/docs/
│   ├── index.mdx                Splash landing
│   ├── start/                   Introduction · Quickstart · Authentication
│   └── guides/                  Publishing · Storing data · Scheduling jobs
├── openapi/shareout.yaml        OpenAPI 3.1 spec → auto-generates /api/*
└── styles/shareout.css          Design-system tokens mapped onto Starlight
```

The API reference is **generated** from `src/openapi/shareout.yaml`. To document
a new endpoint, edit the spec — pages rebuild automatically.

## Commands

| Command           | Action                                  |
| :---------------- | :-------------------------------------- |
| `npm install`     | Install dependencies                    |
| `npm run dev`     | Dev server at `localhost:4321`          |
| `npm run build`   | Build to `./dist/`                      |
| `npm run preview` | Preview the production build            |

## Design system

Theme lives in `src/styles/shareout.css`, mapping ShareOut tokens
(`Design/visual/color.md`, `Design/visual/typography.md`) onto Starlight's CSS
variables: ShareOut Blue `#2563EB` accent, warm-neutral surfaces, Instrument Sans
(display) / Source Sans 3 (body) / JetBrains Mono (code). Don't introduce colors
or fonts outside the design system.

## Notes

- `astro.config.mjs` passes the OpenAPI schema as a decoded `file://` URL to work
  around a `%20`-encoding bug in the schema resolver — it breaks when the checkout
  path contains a space. Don't revert it to a bare relative path.
- The brand mark (`src/assets/shareout-mark.png`) and favicon are cropped from
  the official artwork in the repo-root `Design/brand-art/` folder. The mark fill is
  `#2161FF`; the design-system accent for links/UI is `#2563EB` per `Design/`.

## Deploy

Static output (`dist/`) deploys to any static host. For Cloudflare Pages:
build command `npm run build`, output directory `dist`, root directory
`docs-site`. To serve it from a hostname the Worker owns, set `DOCS_HOST` and
`DOCS_ORIGIN` in the Worker's vars.
