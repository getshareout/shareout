# Creating a New Artifact — the build flow

The canonical, end-to-end flow for building a **new** ShareOut artifact from scratch. Load this first for any "build / make / create a page / dashboard / form / tool / report" request. It exists because the most common failure is jumping straight to code: the result is a generic UI, broken bindings, and SDK errors. Work the flow instead — discover, decide, build from a known-good skeleton, then self-QA before publish.

Think of it as a boutique studio intake: understand the *why* and *who* before the *how*.

## The flow

1. **Check workspace knowledge first.** If the user is on a Teams workspace, pull its context files before anything else — house style, brand voice, data notes, and connectors live there and **override the defaults below**. Fetch `GET /v1/skill?workspace={slugOrId}` (Bearer token) for the bundled `workspace-context.md`, or read context files directly (`GET /v1/workspaces/{id}/context/{name}`, entry defaults to `index.md`). See [../team/workspace-context.md](../team/workspace-context.md). Personal/Pro users skip this.
2. **Discovery — ask before building.** Establish why, who, what data, what-after-publish, and which design system. See [discovery.md](discovery.md). Don't generate until these are answered (or deliberately inferred — see *Adaptive depth*).
3. **Design choice.** Pick the design language: ShareOut default, workspace house style, or a bespoke elevated look. See [design-choice.md](design-choice.md).
4. **Lock the stack.** Clean, separated files (`index.html` + `styles.css` + `app.js` + assets) on a fixed, platform-safe combo — all references **relative** so it works when published. Do not improvise the architecture. See [stack.md](stack.md).
5. **Pick capabilities.** Choose the smallest set of SDK stores that fit the data answer. See the Data Choice ladder in [../SKILL.md](../SKILL.md#data-choice) and [../sdk/overview.md](../sdk/overview.md). Declare every store in the manifest.
6. **Pick destination.** What happens after publish drives this — share link only, scheduled delivery, Slack/email, metric alert, inbound email, or AI chat. See [../api/destinations.md](../api/destinations.md), [../api/jobs.md](../api/jobs.md), [../agents/crew.md](../agents/crew.md).
7. **Decide placement.** Which workspace, folder, and visibility. Personal artifacts default to no folder; Teams artifacts can be foldered. See [../api/folders.md](../api/folders.md) and [../team/folders.md](../team/folders.md).
8. **Build from a skeleton.** Start from a known-good base, never a blank file. See [blueprint.md](blueprint.md).
9. **Self-QA gate.** Run the pre-ship checklist. Do not publish until it passes. See [pre-ship.md](pre-ship.md).
10. **Publish.** Pipe the payload to `curl` (Cloudflare blocks Python `requests`). See [Publishing](../SKILL.md#publishing) and [../api/artifacts.md](../api/artifacts.md). Share the one-line `editor_readiness` summary the publish returns.

## Decision record

Before generating, state a short decision record back to the user and confirm it. It anchors every later choice and makes wrong guesses cheap to catch:

```text
Building:    <page kind> — <one-line purpose>
For:         <owner only | invited | workspace | public>
Data:        <none | json | table | realtime | blobs | live connection>
After:       <share link | collect | schedule | Slack/email | alert | inbound email | AI chat>
Design:      <ShareOut default | workspace house style | bespoke: vibe>
Lives in:    <workspace / folder>, visibility <private | workspace | public>
```

## Adaptive depth

Match the intake to the ask — don't interrogate the user over a throwaway.

- **Trivial / one-shot** ("quick page that says X", a static doc): infer sensible defaults (ShareOut design system, no data, private, share link), build, and surface the assumptions *after* in one line.
- **Real artifact** (anything with data, an audience, or a recurring purpose): run the full discovery before building. The questions take seconds and prevent rebuilds.

When the user signals speed ("quick", "rough", "just"), collapse to the trivial path.

## Why this beats freestyling

- **Bindings over imperative DOM.** The skeleton wires data through `data-shareout-binding` / manifest sources — ShareOut's own declarative layer — instead of hand-rolled `getElementById` + SDK calls, which is the top source of runtime errors. See [stack.md](stack.md#js-reactivity-bindings-first).
- **Design system over invented CSS.** Starting from `shareout.css` + `.so-` classes means brand fonts, a warm palette, and harmonized spacing for free — the default look is "designed," not "auto-generated." See [design-choice.md](design-choice.md).
- **Every state shipped.** The skeleton stubs loading / empty / error / success so the happy-path-only trap is closed before you start.

## Related

- [discovery.md](discovery.md) — the intake questions
- [design-choice.md](design-choice.md) — choosing the design language
- [stack.md](stack.md) — the killer combo (architecture spec)
- [blueprint.md](blueprint.md) — copy-paste starter skeletons
- [pre-ship.md](pre-ship.md) — the self-QA gate
- [../core/html-spec/overview.md](../core/html-spec/overview.md) — full HTML spec
- [../modules/ui/taste.md](../modules/ui/taste.md) — deep design reference
