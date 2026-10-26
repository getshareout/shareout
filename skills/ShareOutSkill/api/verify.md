# Verify — see what viewers see, fix what broke

`POST /v1/artifacts/{id}/verify` opens a published page the way its viewers get it, on a
desktop (1280×800) and a phone (390×844, 2×, touch), and reports what broke: script
errors with `file:line:col`, failed requests, CDNs the viewer's browser refuses,
accessibility problems, content wider than the phone, tiny tap targets, broken images,
blank screens, slow loading, design lint and common source mistakes — plus a screenshot
of each view. One call, typically 5–15 s.

**Run it after every publish or update.** The loop is **publish → verify → fix**: fix the
errors (each comes with `where` and a `hint`), then the warnings, publish again, verify
again. Stop when `status` is `pass` (or only warnings you have decided to keep).

## Request

```bash
curl -sS -X POST "$ORIGIN/v1/artifacts/$ID/verify" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

| Field | Default | Meaning |
|-------|---------|---------|
| `version` | live version | Version number to verify (an approval-pending or older one), rendered entirely from that version's files. |
| `viewports` | `["desktop","mobile"]` | One or both. |
| `full_page` | `false` | Screenshot the whole page height (up to 4000 px) instead of the first screen. |

Owners and editors of the page only. A workspace Agent token (`sot_`) needs
`artifacts:publish` and only reaches pages its principal can edit in its workspace.

## Response

```json
{
  "id": "vfy_3f…", "artifact_id": "art_…", "version": 4, "live": true,
  "status": "fail",
  "summary": "fail — 2 errors, 1 warning, 1 note",
  "counts": { "error": 2, "warning": 1, "info": 1 },
  "issues": [
    { "check": "console", "rule": "js_error", "severity": "error",
      "message": "Uncaught TypeError: Cannot set properties of null (setting 'textContent')",
      "where": "index.html:8:58", "viewports": ["desktop", "mobile"],
      "hint": "An uncaught exception stops the rest of that script — fix it at the line shown…" },
    { "check": "layout", "rule": "horizontal_overflow", "severity": "error",
      "message": "Page is 1018px wider than the phone screen (390px) — widest: main > table.orders (+1018px)",
      "where": "main > table.orders", "viewports": ["mobile"], "hint": "Let it reflow at narrow widths…" }
  ],
  "viewports": [
    { "viewport": "desktop", "width": 1280, "height": 800, "dpr": 1,
      "screenshot": { "url": "$ORIGIN/v1/artifacts/art_…/verify/vfy_3f…/desktop.webp", "width": 800, "height": 500, "full_page": false },
      "metrics": { "load_ms": 310, "lcp_ms": 1090, "cls": 0, "bytes": 72726, "requests": 2 } },
    { "viewport": "mobile", "…": "…" }
  ],
  "design": { "fonts": [{ "family": "Inter", "share": 0.92 }], "accents": ["#2563eb"], "longest_line_chars": 74, "title": "Sales", "missing": ["og:image"] },
  "thumbnail_refreshed": true, "duration_ms": 5195
}
```

- `status`: `fail` = at least one error · `warn` = warnings only · `pass` = neither ·
  `partial` = the page was not rendered and only its source was checked
  (`partial_reason`: `no_browser` — the instance has no Browser Rendering binding — or
  `render_failed` — try again in a minute).
- `issues`: errors first, then warnings, then notes (`info`), at most 60. `where` is
  `file:line:col`, a CSS selector or a URL; `viewports` says where it was seen (absent
  for source checks).
- **Screenshots** are WebP, at most 800 px wide (desktop scaled from 1280, phone at 2×).
  Fetch them with the same token and look at them:
  `curl -H "Authorization: Bearer $TOKEN" -o desktop.webp "<screenshot.url>"`.
- `viewports[].entrypoint` is the file each view rendered: a page published with a
  separate mobile HTML is checked on the phone with that file, as phone viewers get it.
- Verifying the live version also refreshes the page's thumbnail (the MCP tool does not).

`GET /v1/artifacts/{id}/verify/latest` returns the last run (only the latest is kept).

## What it checks

| Rule | Severity | What it means → fix |
|------|----------|---------------------|
| `js_error` | error | Uncaught exception (message + `file:line:col`) → fix that line; wrap async work in try/catch. |
| `storage_blocked` | error / warning | `localStorage`, `sessionStorage`, cookies or IndexedDB used — viewers run the page in a sandbox where they throw `SecurityError` → keep state in memory or use `sdk.json`. |
| `console_error` | warning | `console.error` while loading. |
| `request_failed` | error / warning | A file or request failed (status or network error). `GET /styles.css → 404` means a root-relative path → use `styles.css`. |
| `api_error` | error | A ShareOut API call failed; carries the API's `code` and `hint`. |
| `api_empty_read` | note | `json.get` of a key that does not exist yet — the SDK reads it as empty. |
| `write_skipped` | note | The page writes on load; verify renders read-only, so writes are refused (viewers' writes work). |
| `csp_blocked` | error | The viewer's browser refuses this script/style/font (public pages: CDN allowlist) → `/vendor/<pkg>@<version>/…` or an allowlisted CDN, or keep the page private. |
| `native_dialog` | warning | `alert()`/`confirm()`/`prompt()` blocks the page → inline message. |
| `horizontal_overflow` | error | The page scrolls sideways; names the widest elements and by how many px → `max-width:100%`, wrap, or `overflow-x:auto` on the table's container. |
| `no_viewport_meta` | error | Phones lay the page out at 980 px and zoom out → add `<meta name="viewport" content="width=device-width, initial-scale=1">`. |
| `small_tap_targets` | warning | Phone tap targets under 44×44 px (links inside sentences are exempt). |
| `broken_image` | error | An image failed to load. |
| `blank_page` | error | No text, image or chart visible after load — usually a script error before first render. |
| `ready_flag_not_set` | warning | The page uses `window.__shareoutReady` but never set it to `true`. |
| axe rule ids (`image-alt`, `color-contrast`, `label`…) | critical/serious → error, moderate → warning | WCAG 2.1 A/AA problems from axe-core; `hint` links the fix guide. |
| `slow_lcp` / `layout_shift` / `heavy_page` | warning (or note) | LCP > 4 s, CLS > 0.25, more than 5 MB downloaded. |
| `too_many_fonts` / `too_many_accents` / `long_lines` / `font_failed` | warning | Design lint: more than 2 text families, more than 3 accent hues, lines over ~100 characters, a web font that failed. |
| `missing_meta` | note | No `<title>`, meta description, `og:image` or favicon. |
| `absolute_path` | error | Source: a root-relative path to the page's own files (`/styles.css`) → `styles.css`. Only `/sdk/`, `/vendor/`, `/lib/` may stay root-relative. |
| `browser_storage` | warning | Source: `localStorage`/`sessionStorage` (see `storage_blocked`). |
| `raw_data_fetch` | error | Source: `fetch('/v1/data/…')` → use the SDK. |
| `sdk_constructor` | error | Source: `new ShareOut()` → `await ShareOut.create()`. |
| `cdn_not_allowed` | error | Source: a public page loads a script/style from a host outside the allowlist. |

## How it renders (what is and is not a defect)

- The page opens on its own content origin, in a fresh browser with **no ShareOut
  session**, exactly as a viewer's sandboxed frame would load it. Its data reads carry a
  short **read-only** session for this page alone, attached by the renderer (page
  scripts never see it) and tied to no person: reads that depend on who the viewer is
  do not resolve in the render.
- Requests leave only for the page itself: no navigation to other sites, no private
  network addresses, no popups.
- Writes and emails the page makes while loading are refused — a `write_skipped` note,
  not a failure.
- Interactions (clicks, form fills) are not run. Use [tests.md](tests.md) flows for those.

## Limits

30 runs per user per hour unless the instance sets `VERIFY_RUNS_PER_HOUR`
(`429 RATE_LIMIT_EXCEEDED` with `Retry-After`, `limit` and `reset`). Batch fixes and
verify once per change set; do not loop on the same failure — after two tries with no
progress, follow the `hint` or ask the user.

## From an AI app (MCP)

The ShareOut connector's `verify_artifact` tool runs the same check and answers with a
short report (≤ 40 lines) plus the desktop and phone screenshots. It is marked read-only
(it changes nothing on the page and leaves the thumbnail alone), so an AI app can call it
in a fix loop without asking each time. Call it right after `publish_artifact`,
`update_artifact` or `edit_artifact`.

## Related

- [../creating/pre-ship.md](../creating/pre-ship.md) — the checklist verify automates part of
- [artifacts.md](artifacts.md) — publish, versions, thumbnails
- [tests.md](tests.md) — Artifact Tests (smoke, contract, flows) on every publish
