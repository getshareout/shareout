# One-time view — link + a personal code, one look each

Use this when the user wants to show something confidential to a few named people **once**:
"send the new prices to the branch managers, they can only see it once", "make it disappear
after they read it", "no screenshots, no downloads".

Each person gets their own link with their code already in it (the user sends it, e.g.
over WhatsApp). They open it and tap **Open** — no account, no sign-in, nothing to type. The
plain page link plus the code works too. The code opens the page **once**, for a set number of
seconds (default 90), then the page closes by itself and the code never works again.

What the viewer sees and does not see:

- Their **name is written across the page** (watermark), with the date and time they opened it.
- **No countdown.** The page just closes when the time is up, with a thank-you ("Thanks for
  reading — this content is no longer available"). The code page never says the code works once.
- Copy, select, right-click, drag, print and save are blocked. There is no toolbar, no
  download, no assistant. The page cannot be opened outside its viewer (its frame URL
  answers 403 in a tab of its own).
- When they switch apps or tabs, the page blurs.

Be straight with the user about the limits — say it in plain words before they rely on it:

- **Nothing in a browser can block a screenshot, or a photo of the screen with another
  phone.** The watermark is the defence: any capture carries the person's name.
- The log shows **attempts**, not proof: copy, print, save, right-click, the screenshot key
  on a computer, leaving the page. A phone screenshot sends no signal at all.
- If someone forwards their link (or link + code), whoever opens it first uses it up — the real
  person then sees "this access was already used", and the log shows the device, browser and
  approximate city it opened from.

## Rules for the page

- Web pages only (`type: html`). The page must carry its content in its HTML: a code holder
  has no session, so `sdk.json`, tables, connections and other live data calls do not work.
- Turning it on makes the page **private**. The owner and named collaborators still open it
  normally (signed in) to check it and manage the codes, with a notice that their view is not
  locked; nobody else gets in without a code. So "I can still open it" from the owner means
  they are signed in — to see what a recipient sees, open a link in a private window. Opening a
  personal link while signed in does not use the code up.
- One code per person. The code is shown **once**, in the create response — hand it to the
  user right away; it cannot be read back later (only its hash is stored).

## API

All calls need the owner's (or an editor's) personal token. Agent (`sot_`) tokens cannot create or revoke codes.

```bash
# Create codes — turns one-time view on
curl -s -X POST "$ORIGIN/v1/artifacts/$ARTIFACT_ID/view-codes" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"recipients": ["Ana Gómez · Sucursal Centro", "Luis Pérez · Sucursal Norte"], "view_seconds": 90}'
```

```json
{
  "enabled": true,
  "url": "https://acme.shareout.site/precios-noviembre/",
  "view_seconds": 90,
  "codes": [
    { "id": "vcd_…", "label": "Ana Gómez · Sucursal Centro", "code": "K7M4-QP9X",
      "link": "https://acme.shareout.site/precios-noviembre/#code=K7M4-QP9X", "view_seconds": 90, "created_at": "…" }
  ]
}
```

- `recipients`: names (strings, or `{ "label": "…" }`), 1–100 per call. The name is the
  watermark, so use something that identifies the person.
- `view_seconds`: 10–600, default 90. Pick it for how long the page takes to read: 90 s is
  a short notice; a long letter needs 5–10 minutes.
- `link`: the person's own link — the page URL with `#code=…`. It fills the code in on the
  code page; nothing is spent until they tap Open, so a WhatsApp link preview is safe.
- More people later? Call it again — existing codes are untouched. Someone lost theirs or
  opened it by accident? Create a new code for them.

```bash
# Who opened, when, from what device, what they tried
curl -s "$ORIGIN/v1/artifacts/$ARTIFACT_ID/view-codes" -H "Authorization: Bearer $TOKEN"
```

Each code: `status` (`unused` · `open` · `viewed` · `revoked`), `opened_at`, `closed_at`,
`opened_device` (`phone` · `tablet` · `computer`), `opened_browser` (e.g. `Chrome · Android`),
`opened_city`, `opened_region`, `opened_country` (Cloudflare's approximate location — the IP is
never stored), and `attempts`, e.g.
`{ "copy": 2, "left_page": 1 }`. Kinds: `copy`, `print`, `save`, `context_menu`,
`screenshot_key`, `left_page`. Codes are never returned again.

```bash
# Revoke one code (an open page loses its pass at once)
curl -s -X DELETE "$ORIGIN/v1/artifacts/$ARTIFACT_ID/view-codes/$CODE_ID" -H "Authorization: Bearer $TOKEN"

# Turn one-time view off: every code stops working; the page stays private behind sign-in
curl -s -X DELETE "$ORIGIN/v1/artifacts/$ARTIFACT_ID/view-codes" -H "Authorization: Bearer $TOKEN"
```

## Handing the codes to the user

Give one ready-to-send message per person, in the user's language, with their personal
`link`, so they can paste each into WhatsApp as is:

```
Ana: https://acme.shareout.site/precios-noviembre/#code=K7M4-QP9X
Luis: https://acme.shareout.site/precios-noviembre/#code=8RWD-2HNE
```

Each link is personal: send it only to that person, never to a group.

Do not tell the recipients the page closes, or that the code works once, unless the user
asks you to — that is the point.
