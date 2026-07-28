---
title: Viewer analytics & tracked links
description: See who viewed a deck, how far they got, and where they lingered — with per-recipient tracked links and open alerts.
---

ShareOut Slides turns a published deck from an anonymous viewer into a sales surface. Every view is captured automatically, you can send **tracked, gated links** to name each viewer, and you get an **email the moment someone opens** your deck.

## What you get

- **Automatic capture** — every published deck records view sessions with no extra code.
- **Per-slide engagement** — dwell time per slide and where viewers drop off.
- **Tracked links** — one link per recipient, optionally gated by email, password, or domain.
- **Open alerts** — "Acme just opened your proposal" emailed to you.
- **Owner dashboard** — `/app/slides/{artifactId}/analytics`.

## Capture is automatic

Opening a deck with `so.slides.view()` starts engagement capture on its own — session count, unique viewers, duration, device, and country. No template changes needed.

```javascript
const deck = await so.slides.view('pres_...');   // capture is now ON
```

To also get **per-slide dwell and drop-off**, tell the deck when the viewer changes slides:

```javascript
deck.trackSlide(index);   // call from your navigation handler
```

Opt out with `so.slides.view(id, { track: false })`.

Privacy: viewer IPs are stored hashed (never raw), `DNT: 1` suppresses IP / user-agent / country, and an email is only retained when a viewer gives it through a gated link.

## Tracked & gated links

A tracked link attributes a session to a named recipient and can require credentials before the deck opens.

```javascript
// Owner: mint a per-recipient link
const link = await deck.links.create({
  recipientLabel: 'Acme Corp',
  gate: 'email',            // 'none' | 'email' | 'password' | 'domain'
  maxViews: 25,             // optional cap
  expiresAt: '2026-12-31T00:00:00.000Z', // optional
});
// share link.url → https://shareout.site/p/<deck>?l=lnk_...

await deck.links.list();          // links with live view counts
await deck.links.revoke('lnk_...'); // analytics for past views are kept
```

When a recipient opens a link, ShareOut handles the gate and attributes the session:

```javascript
// Open gate (gate: 'none') — fully automatic, nothing to do.

// Challenge gate (email / password) — collect the value, then:
const deck = await so.slides.view('pres_...', { track: false });
const { sessionId } = await deck.links.access('lnk_...', { email });
await deck.startTracking(sessionId);   // session is now named
```

| Gate | Requires before viewing |
|------|--------------------------|
| `none` | nothing — session still attributed to the recipient |
| `email` | a valid email (captured as the viewer's identity) |
| `domain` | an email whose domain is on your allowlist |
| `password` | the password you set (stored hashed) |

## Open alerts

When a recipient opens a tracked link, the deck owner is emailed — for example *"Acme Corp opened Q3 Proposal."* Repeat opens of the same link are deduped to one email per 30 minutes so a refresh never spams you. Anonymous public views stay quiet; only tracked-link opens notify.

## Owner dashboard

Read everything at **`/app/slides/{artifactId}/analytics`** (owner or non-viewer collaborator only):

- summary tiles — total views, unique viewers, average time, completion rate
- per-slide bars with drop-off shading
- a sessions table — viewer/email, device, country, slides seen, completed, when
- the tracked-links panel — create, copy, and revoke links

You can also read the same data programmatically:

```javascript
const a = await deck.analytics();
// { summary, perSlide: [{ slideIndex, views, avgDwellMs, dropOffRate }], sessions: [...] }
```
