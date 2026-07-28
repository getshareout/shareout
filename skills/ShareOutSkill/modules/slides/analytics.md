# Deck viewer analytics & tracked links

Turn a published deck into a sales surface: capture who viewed it, how far they got, and where they lingered — with per-recipient **tracked links** and an **open alert** email. Full method signatures live in [sdk-api.md](./sdk-api.md); this is the intent-level guide.

## Capture is automatic

`so.slides.view(id)` auto-starts engagement capture — session count, unique viewers, duration, device, country — with **zero template changes**. Open tracked links (`?l=`) are auto-attributed to the recipient.

```javascript
const deck = await so.slides.view('pres_...');   // capture ON
deck.trackSlide(index);                          // call on each slide change → per-slide dwell + drop-off
```

- Without `trackSlide()` you still get session-level metrics; with it you also get per-slide dwell, drop-off, and completion.
- Opt out: `so.slides.view(id, { track: false })`.
- Privacy: IP hashed (never raw), `DNT: 1` suppresses IP/UA/country, email retained only when given via a gated link.

## Tracked & gated links

```javascript
const link = await deck.links.create({
  recipientLabel: 'Acme Corp',
  gate: 'email',     // 'none' | 'email' | 'password' | 'domain'
  maxViews: 25,      // optional
  expiresAt: '2026-12-31T00:00:00.000Z', // optional
});
// link.url → $ORIGIN/p/<deck>?l=lnk_...
await deck.links.list();            // live view counts
await deck.links.revoke('lnk_...'); // past analytics kept
```

Challenge gates (email/password) need your UI to collect the value, then:

```javascript
const deck = await so.slides.view('pres_...', { track: false });
const { sessionId } = await deck.links.access('lnk_...', { email });
await deck.startTracking(sessionId);   // session is now named
```

Open gates (`gate: 'none'`) attribute automatically — nothing to wire.

## Open alerts

When a recipient opens a **tracked link**, the deck owner is emailed (e.g. *"Acme Corp opened Q3 Proposal"*), deduped to one email per link per 30 min. Anonymous public views stay quiet.

## Owner dashboard

Owner-only page at **`/app/slides/{artifactId}/analytics`**: summary tiles, per-slide drop-off bars, sessions table (viewer/email, device, country, slides seen, completed), and tracked-link management (create/copy/revoke).

Programmatic read:

```javascript
const a = await deck.analytics();
// { summary:{totalViews,uniqueViewers,avgDurationMs,completionRate},
//   perSlide:[{slideIndex,views,avgDwellMs,dropOffRate}], sessions:[...] }
```
