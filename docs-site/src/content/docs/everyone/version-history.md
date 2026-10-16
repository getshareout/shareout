---
title: Version history & restore
description: See who changed your artifact, how and what changed, compare any two versions, and bring an old one back without losing anything.
---

Every publish makes a new **version** of your artifact: v1, v2, v3… Nothing is ever
overwritten. The **History** tab shows them all, and you can put any old version back
live in one click.

## Open History

Open the artifact on [Home](/everyone/your-workspace/) and pick **History** in the
Inspector. Each version shows:

- **Who** published it (or "Someone" when it is not known).
- **How** it was made: **Published** (API), **Agent**, **Editor** or **Restore**.
- **When**, and a **Live** badge on the version people see right now.
- **What changed** — a one-line note (see [Change notes](#change-notes)).
- How many **comments** and **approvals** that version got
  (see [Review & approvals](/everyone/review/)).

History lists the 50 most recent versions. It is visible to the people the artifact
is shared with.

## See what changed

Open **What changed** on a version to see a line diff against the version before it.
Added and removed lines are highlighted; long runs of unchanged lines collapse into
"N unchanged lines".

To compare any two versions, pick an **Older version** and a **Newer version** and hit
**Compare**.

The diff covers the artifact's main HTML file. For a very large file only the start is
compared.

## Preview an old version

**Preview** opens a version exactly as it was, in a sandbox. Live data and sign-in
don't run in a preview, so what you see is the page itself, not today's numbers.

## Restore a version

**Restore vN** publishes a **new** version with the content of vN. Nothing is deleted:
every version, including the ones after vN, stays in History, and the new one is marked
"Restored from vN". If you change your mind, restore the version you came from.

You need **Can edit** on the artifact (or be its owner, or a workspace owner/admin) to
restore. If the artifact has tests, the restored version goes live once its tests pass.

:::note[Rollback is deprecated]
The older "rollback to the previous version" API still works but is deprecated. Use
restore instead: it can bring back any version, not only the last one, and keeps
history intact. See the [API reference](/api/).
:::

## Change notes

When you publish from the API or from an AI app connected to ShareOut, you can send an
optional `message` saying what you changed. It shows next to that version in History.

When a version is published without a note, ShareOut writes a one-line "what changed"
note for you from the differences with the previous version. These notes carry an
**AI** badge in History so you can tell them apart from notes people wrote. First
versions, restores and publishes that didn't change the page get no AI note.

The note for the live version also shows in **Details** as "Updated &lt;time&gt;: &lt;note&gt;".

AI notes are controlled by the **Version change notes** feature
(`ai.version_summaries`, on by default), listed under **Admin → Features**. Workspace
admins can see it there; the instance admin switches it per workspace. AI notes also
need an AI provider configured on the instance.

## What's next

- [**Review & approvals**](/everyone/review/) — comment on a version and sign it off.
- [**Publishing artifacts**](/guides/publishing/) — versions, slugs and the publish API.
