# Discovery — the intake before you build

Ask these before generating. They take seconds and prevent the expensive failure: building the wrong thing beautifully. Expands [../SKILL.md](../SKILL.md#first-questions) — don't re-ask what the user already told you, and on a trivial ask infer instead (see [overview.md](overview.md#adaptive-depth)).

Ask in plain language, batched — not a rigid interrogation. The goal is to fill the decision record in [overview.md](overview.md#decision-record).

## 1. Why — the outcome

What is this *for*? The purpose drives every later dial (density, motion, destination).

| Purpose | Implications |
| --- | --- |
| **Deliverable** (a report/tool handed off once) | Polished, self-contained, share link or PDF; provenance matters. |
| **Daily monitoring** (a dashboard you revisit) | Live or scheduled data, KPIs, low motion, alerting. |
| **Client presentation** (pitch, deck, proposal) | High craft, narrative flow, slides module, tracked-link analytics. |
| **Internal tool** (form, tracker, admin) | Function over flourish, fast input, clear states. |
| **Public page** (landing, microsite) | Marketing taste, SEO meta, og:image, varied layout. |

## 2. Who — the audience

Who opens it? This sets visibility and auth.

| Audience | Visibility | Notes |
| --- | --- | --- |
| Owner only | `private` | Default for drafts and personal tools. |
| Specific invited people | `private` + `share_with` | Per-email; viewers sign in (Google or email code). |
| A whole workspace | `workspace` | Everyone in the artifact's workspace (needs `workspace_id`). |
| The internet | `public` | Anyone on the internet with the link; discoverable/listed. Teams may gate this — see [../team/publish-governance.md](../team/publish-governance.md). |

Audience also picks the *aesthetic* — a finance dashboard, a kid's quiz, and a luxury deck want different design reads. Carry that into [design-choice.md](design-choice.md).

## 3. What data — the store

Pick the **smallest** store that fits (full ladder in [../SKILL.md](../SKILL.md#data-choice)). Over-reaching here is a common bug source.

```text
None — static content only            -> no store, just HTML
Simple state — theme, filters, prefs  -> sdk.json
Structured records — rows, submissions-> sdk.table()
Realtime — multiplayer docs/boards    -> sdk.realtime()
Files — images, PDFs, uploads         -> sdk.blobs
Live external — REST, BigQuery, Sheets-> sdk.connection / live-data
```

Whatever you pick, it MUST be declared in the manifest `sources` (with `default` sample rows so the editor previews without a live fetch). See [../core/html-spec/manifest.md](../core/html-spec/manifest.md). Per-store detail: [../sdk/overview.md](../sdk/overview.md).

## 4. After publish — the destination

What should happen once it's live? This is where artifacts earn their keep — and it's easy to forget to ask.

| Want | Load |
| --- | --- |
| Just a share link | nothing extra |
| Collect data from viewers | [../patterns/forms.md](../patterns/forms.md), [../sdk/table.md](../sdk/table.md) |
| Notify owner / send email | [../sdk/email.md](../sdk/email.md) |
| Scheduled delivery (Slack/email/sheet) | [../api/jobs.md](../api/jobs.md), [../api/destinations.md](../api/destinations.md) |
| Refresh a snapshot on a schedule | [../api/jobs.md](../api/jobs.md#querysnapshotconfig) |
| Query → summarize → deliver (automation) | [../agents/crew.md](../agents/crew.md) |
| Alert when a number crosses a threshold | [../api/metric-alerts.md](../api/metric-alerts.md) |
| Receive / act on inbound email | [../integrations/inbound-email.md](../integrations/inbound-email.md) |
| Let viewers chat with AI in the page | [../agents/overview.md](../agents/overview.md) |

**Delivery gotcha:** if the artifact is delivered by screenshot (Slack/PDF/thumbnail/email), charts must be **SVG** (e.g. Plotly), not `<canvas>` — server-side capture renders canvas blank. See [stack.md](stack.md#charts).

## 5. Design system — always offer ShareOut

Ask which look they want. Default to the ShareOut design system unless they have a reason not to. Three paths, detailed in [design-choice.md](design-choice.md):

1. **ShareOut design system** (default) — `shareout.css` + `.so-` classes; inherits brand fonts, palette, spacing.
2. **Workspace house style** — if Teams context files define brand/CSS, use them.
3. **Bespoke elevated look** — a distinctive, committed aesthetic for marketing/presentations.

## Confirm, then build

Reflect the decision record back in one block (see [overview.md](overview.md#decision-record)) and get a nod. Then go to [stack.md](stack.md) and build from [blueprint.md](blueprint.md).

## Related

- [overview.md](overview.md) — the full flow
- [design-choice.md](design-choice.md) — choosing the design language
- [../SKILL.md](../SKILL.md#first-questions) — the short first-questions list
- [../sdk/overview.md](../sdk/overview.md) — SDK store reference
