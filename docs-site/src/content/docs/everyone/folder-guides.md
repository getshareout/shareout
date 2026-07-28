---
title: Folder guides
description: Give a folder a short guide — what belongs in it and how to build for it — and the people and AI agents working there follow it.
---

A folder in ShareOut isn't just a place to drop pages. It can carry a **guide**: a short note that says what belongs in the folder and how things here should be built. People read it when they open the folder — and so do the AI agents that build your pages.

Think of it as the folder's house rules.

## Why bother

When you (or an agent) make a new page inside a folder, the guide is the context that keeps everything consistent:

- **Audience** — "these are for execs" vs "these are customer-facing."
- **Look** — "use our brand colors, no stock gradients."
- **Data** — "pull numbers from the `sales` dataset."
- **Rules** — "keep private until someone reviews it."

Without a guide, every page starts from scratch. With one, the folder itself remembers how its work should look.

## Add a guide

Open a folder in **Home → All Artifacts**. At the top you'll see **Add a folder guide** (if you can manage the folder). Click it, write a few lines of Markdown, and save.

```markdown
# Q3 Campaign

Pages here are for the leadership review.

- Audience: execs — plain language, no jargon
- Brand palette only, charts as SVG
- Source: the `sales` dataset
- Keep private until reviewed
```

Edit or clear it anytime with the pencil on the guide.

## Who can edit it

- **Personal folders** — you, the owner.
- **Team Space folders** — workspace owners and admins. Everyone on the team sees the guide; it keeps the whole team (and its agents) aligned.

## It works for agents

This is the point. When an AI agent edits a page that lives in a guided folder, ShareOut hands it the guide automatically — so it builds to your conventions without you repeating them every time. Agents publishing through the API can read a folder's guide too.

## Related

- [Your workspace (Home)](/everyone/your-workspace/) — folders and the Home layout
- [Add a smart assistant](/everyone/assistant/) — AI inside a page
