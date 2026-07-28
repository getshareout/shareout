# Pre-ship — the self-QA gate

Run this before every publish. If a box can't be honestly ticked, it's not done. This catches the failures the build flow is meant to prevent: missing states, inaccessible UI, generic looks, SDK errors, moderation surprises. It consolidates the design pre-ship list in [../modules/ui/taste.md](../modules/ui/taste.md#pre-ship-checklist) with the platform gotchas from [stack.md](stack.md).

## States

- [ ] **Loading** — instant first paint, no blank screen (a skeleton or visible content, not a bare spinner).
- [ ] **Empty** — explains what the section is for and the next action, not "No data".
- [ ] **Error** — inline, specific, with a recovery path; a rejected SDK call never blanks the page.
- [ ] **Success / disabled** where relevant — feedback after actions; disabled controls explain what enables them.

## Accessibility

- [ ] Every interactive element is keyboard reachable, with a **visible focus ring**.
- [ ] Text contrast ≥ 4.5:1 (≥ 3:1 for large text); state never communicated by color alone.
- [ ] Semantic HTML (`<nav>`, `<main>`, `<button>` for actions, `<a>` for links); inputs have `<label for>`.
- [ ] Motion respects `prefers-reduced-motion`.

## Responsive

- [ ] Checked at ~375px width — layout **reflows**, not squeezed; columns stack.
- [ ] Touch targets ≥ 44px; desktop nav on one line.

## Files & paths (publish-correctness)

- [ ] Code is **separated by concern** — `index.html` / `styles.css` / `app.js` / `assets/` — not one monolith (single file only for a trivial throwaway). See [stack.md](stack.md#file-shape--single-file-or-multi-file).
- [ ] **Every internal reference is relative** (`styles.css`, `./app.js`, `assets/logo.png`, `about.html`) — no absolute `/path` references. Artifacts serve under `/a/{slug}/`; absolute paths 404 after publish. The only absolute URLs are the ShareOut SDK/CSS (and any deliberate external resource). This is the #1 "worked locally, broke when published" bug.
- [ ] Publish payload is a `files` array with the right `entrypoint` (default `index.html`); binary assets use `encoding: "base64"`.
- [ ] **Assets in the right place:** static app assets in `files[]` (edge-cached immutable); heavy/user media in `sdk.blobs` via `getDownloadUrl()` (direct-from-R2), not multi-MB base64 in the bundle. See [stack.md](stack.md#assets--egress--where-each-file-should-live).

## Moderation-safe (avoids surprise private-flag)

- [ ] **External scripts/styles load only from the CSP allowlist** on public pages — jsDelivr, unpkg, cdnjs, esm.sh, Skypack, Google-hosted, `cdn.tailwindcss.com`, jQuery, D3, Plotly, Highcharts, DataTables, Bootstrap (covers most libraries). A CDN outside the list is blocked, and publishing/making-open is refused with a message naming the host. Need a niche CDN → keep the artifact **private** and add collaborators. See [stack.md](stack.md#what-we-deliberately-do-not-use-by-default).
- [ ] **Don't inline a library's minified source** — a single long minified line trips the obfuscation heuristic → held private. Load it from an allowlisted CDN instead. (Bindings/vanilla JS remain the default — see [stack.md](stack.md#js-reactivity-bindings-first).)
- [ ] **No large inline `<script type="application/json">` data blobs** — load data via the SDK.

## Publish limits (the API will reject or downgrade)

- [ ] **Public needs a verified email.** A bootstrap/no-email account is silently allowed to publish, but the result is forced **private** (response carries `visibility_downgraded: true` + `requested_visibility`). Link an email to actually go public.
- [ ] **File MIME must be on the publish allowlist** (~22 types: html/css/js/json, common images, fonts, text, csv, pdf, wasm…). Other types (e.g. `application/octet-stream`, `text/typescript`) → `VALIDATION_ERROR` 400.
- [ ] **Size caps:** ≤ 100 MB per file, ≤ 500 MB total per publish, plus a per-account storage quota (`STORAGE_LIMIT_EXCEEDED` 413). Heavy media belongs in `sdk.blobs`, not the bundle.
- [ ] **Rate limit:** 30 publishes/hour per account (`RATE_LIMIT_EXCEEDED` 429). Batch iterations locally, don't republish in a tight loop.

## SDK & data

- [ ] Init is `await ShareOut.create()`, wrapped in try/catch.
- [ ] Every store used (`json` keys, `table()` names, `connection()` names) is **declared in the manifest** with `default` sample data for editor preview.
- [ ] Dynamic data is painted via **`data-shareout-binding` / templates**, not imperative `getElementById` + `innerHTML`.
- [ ] No raw `fetch` to `/v1/data/...` — SDK methods only.
- [ ] Charts are **SVG (Plotly)** if the artifact is delivered by screenshot (Slack/PDF/thumbnail/email); `<canvas>` only for view-only interactive. See [stack.md](stack.md#charts).

## Design (no AI-slop)

- [ ] Design system used where it fits (`.so-` classes + tokens); custom CSS only where needed; custom looks retheme `--so-*`, not hardcoded hex.
- [ ] **One accent, one font system, one radius, one gray family** across the whole artifact.
- [ ] **One primary action per screen**; key actions have icon + label.
- [ ] Generous whitespace; clear hierarchy from weight/color/space.
- [ ] Ran the [anti-slop ban list](../modules/ui/taste.md#anti-slop-ban-list): no purple/neon glow, no Inter/Roboto default, no three-equal-cards, no marketing clichés, no fake-perfect numbers, no eyebrow spam.
- [ ] Copy re-read for plain language.

## Provenance & meta

- [ ] Data-backed artifact declares its **sources** (label/description/query) so viewers can answer "where does this come from?" See [../patterns/data-provenance.md](../patterns/data-provenance.md).
- [ ] Real `<title>`, meta description, and `og:image` for sharing; a favicon.

## Then publish

Pipe the payload to `curl` (Cloudflare blocks Python `requests`). See [Publishing](../SKILL.md#publishing). Read back the advisory `editor_readiness` profile and share the one-line summary with the user — treat it as guidance, not a gate.

## Related

- [stack.md](stack.md) — the rules being verified here
- [../modules/ui/taste.md](../modules/ui/taste.md#pre-ship-checklist) — the deep design checklist
- [overview.md](overview.md) — the full build flow
- [../api/artifacts.md](../api/artifacts.md) — publish + editor_readiness
