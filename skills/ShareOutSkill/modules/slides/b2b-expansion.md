# ShareOut Slides — B2B Expansion Plan

Turning Slides from a *viewer* into a *sales & engagement surface*. This plan leads with **viewer analytics** (highest B2B willingness-to-pay) and sequences the features that build on top of it.

> Status: planning. Nothing here is built yet except where noted. Grounded in the **current** implementation (D1 tables + `broadcastEvent`), not the Y.js CRDT design described in [overview.md](./overview.md) — analytics layers cleanly onto today's architecture without waiting on the CRDT migration.

## The thesis

Today, viewing a deck at `/p/{slug}` is **anonymous and invisible to the owner**: read-only slides, fullscreen present, live-follow a presenter. That is a viewer, not a sales tool.

B2B buyers (sales enablement, RevOps, marketing) pay for the inverse of anonymous: **knowing who looked at what, for how long, and being told the moment it happens.** This is the DocSend / Pitch / Pitch.com wedge. Every feature below ladders up to that.

## Current state (what exists)

| Capability | Status | Source |
|---|---|---|
| Presentations / slides / versions | ✅ D1-backed | [presentations.ts](../../../shareout-app/src/data/slides/presentations.ts), [versions.ts](../../../shareout-app/src/data/slides/versions.ts) |
| Publish + visibility (public/private) | ✅ | [publish.ts](../../../shareout-app/src/data/slides/publish.ts) |
| Presenter state sync (slide, timer, laser, countdown) | ✅ server-side | [presenter.ts](../../../shareout-app/src/data/slides/presenter.ts) |
| Presenter view UI | ⚠️ basic `window.open` popup | [editor/presentation/index.ts](../../../shareout-app/src/editor/presentation/index.ts) |
| Realtime transport | ⚠️ `broadcastEvent`, not Y.js CRDT yet | [realtime.ts](../../../shareout-app/src/data/slides/realtime.ts) |
| **Viewer analytics** | ✅ capture auto-wired in `slides.view()`, owner API + dashboard at `/app/slides/{artifactId}/analytics` | [analytics.ts](../../../shareout-app/src/data/slides/analytics.ts), [pages/slides-analytics.ts](../../../shareout-app/src/pages/slides-analytics.ts), SDK `presentation.analytics()` |
| **Access control beyond public/private** | ⚠️ tracked & gated links shipped (P1): email/password/domain gate, expiry, view cap | [links.ts](../../../shareout-app/src/data/slides/links.ts), SDK `presentation.links` |
| **Lead capture / CTAs / notifications** | ⚠️ view-open email shipped (P2): owner emailed when a tracked link is opened, 30-min per-link cooldown | [links.ts](../../../shareout-app/src/data/slides/links.ts) `notifyOwnerOnOpen`, email `slides_deck_opened` |

## Roadmap (priority order)

### P0 — Viewer analytics *(lead feature)*

The foundation. Capture every view session and per-slide engagement so an owner can answer: *who opened it, how far did they get, where did they linger, where did they drop?*

**Data model** (new D1 tables, sibling to `presentations`):

```
view_sessions
  id              text pk        -- ses_*
  presentation_id text fk
  viewer_id       text null      -- set if gated/known (see P1)
  viewer_email    text null      -- captured at gate
  link_id         text null      -- tracked link used (see P1)
  ip_hash         text           -- hashed, not raw (privacy)
  user_agent      text
  country         text null      -- from CF request.cf
  started_at      text
  last_seen_at    text
  completed       integer        -- reached final slide
  duration_ms     integer

slide_views
  id              text pk
  session_id      text fk
  presentation_id text fk
  slide_id        text fk
  slide_index     integer
  entered_at      text
  dwell_ms        integer        -- accumulated time on this slide
```

**Capture mechanism**: the `/p/` viewer client posts heartbeats (`POST /data/slides/{id}/analytics/beat`) on slide enter/exit and every ~10s while visible (`visibilitychange` aware). Server upserts `slide_views.dwell_ms` and `view_sessions.last_seen_at`. No CRDT needed — plain D1 writes, same pattern as `presenter.ts`.

**Owner-facing API** (`GET /data/slides/{id}/analytics`):
- summary: total views, unique viewers, avg completion %, avg duration
- per-slide: view count, avg dwell, drop-off rate (heatmap-ready)
- session list: each viewer, email (if known), device/country, slides seen, when

**Privacy**: hash IP, honor DNT, no raw PII beyond email the viewer chose to give. Document retention. This matters for selling to larger teams and EU customers.

**Why first**: clear willingness-to-pay, no migration dependency, and it's the substrate every other P-tier reads from.

### P1 — Tracked & gated links

Make each share a *tracked* link, optionally gated. This is what converts anonymous analytics into *named* analytics.

```
share_links
  id              text pk        -- lnk_*
  presentation_id text fk
  slug            text unique    -- /p/{slug}?l={lnk_id} or vanity
  recipient_label text null      -- "Acme Corp", "John @ Globex"
  gate            text           -- 'none' | 'email' | 'password' | 'domain'
  gate_value      text null      -- password hash / allowed domain
  expires_at      text null
  max_views       integer null
  created_at      text
  revoked         integer
```

- **Per-recipient links** → attribute every session to a named prospect.
- **Email gate** → viewer enters email before slide 1; `viewer_email` flows into analytics + lead capture.
- **Password / domain allowlist / expiry / view cap** → access control B2B security teams require.

Extends the current 3-state `visibility`; doesn't replace it.

### P2 — Real-time view notifications ✅ (open-email shipped)

"**Acme just opened your proposal.**" Shipped: the deck owner is emailed (`slides_deck_opened`, product category) the moment a recipient passes a **tracked-link** gate, deduped to one email per link per 30 min so a refresh doesn't spam. Only tracked-link opens notify — anonymous public views stay quiet (high signal, low noise).

Still open: per-slide milestone alerts ("on slide 4 now") and Slack/Discord/webhook fan-out (email is the only surface today).

### P3 — Lead capture & CTAs

The deck becomes a conversion surface, not just content:
- email-gate doubles as lead-gen (already captured in P1)
- embedded CTAs in the `/p/` viewer chrome: "Book a call", "Download PDF", "Request access"
- gated downloads (deck PDF, attachments) behind email
- post-view CTA slide / redirect

### P4 — White-label viewer

Remove the SaaS smell for larger Teams customers:
- custom logo + accent on `/p/` chrome (reuse `default_colors`)
- custom domain / existing Teams subdomain (`{workspace}.example.com`)
- strip ShareOut branding on paid tiers
- branded email-gate and notifications

### P5 — Deal rooms / collections

Bundle multiple decks + assets under one tracked link per account ("Acme deal room"), with roll-up analytics across the bundle. The land-and-expand surface for larger contracts.

## Sequencing rationale

P0 is the keystone — P1 names the analytics, P2 alerts on them, P3 monetizes the captured emails, P4/P5 are packaging for larger deals. Build P0→P1→P2 as the sellable MVP ("tracked decks with live analytics + alerts"); P3–P5 are expansion revenue.

## Open questions / dependencies

- **CRDT migration**: this plan deliberately avoids it. The viewer is read-only, so analytics work on the current transport. Revisit only if live collaborative *viewing* is needed.
- **Pricing/packaging**: which tier gates analytics vs. white-label? (out of scope here)
- **Schema migrations**: confirm the D1 migration workflow before adding `view_sessions` / `slide_views` / `share_links`.
- **Presenter view rebuild**: the basic `window.open` popup ([index.ts:336](../../../shareout-app/src/editor/presentation/index.ts#L336)) is below the bar for a paid B2B product and should be rebuilt alongside P0.
