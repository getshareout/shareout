---
title: Knowledge search
description: Search what the workspace knows — cited passages from its Files and pages — from inside a running page.
---

import { Aside } from '@astrojs/starlight/components';

`sdk.knowledge.search()` searches the page's own workspace
[Knowledge](/teams/knowledge/) — the cited passages learned from its uploaded Files
(PDFs, docs, sheets…) and published pages — and returns the ones that answer a
question. Use it for an internal page that has to quote policy, contracts or past
reports.

<Aside type="note" title="Members only">
Only a **signed-in internal member** of the artifact's workspace gets results.
Anonymous visitors, public-link viewers and external sharees get an error. The
artifact must belong to a workspace with Knowledge turned on.
</Aside>

## Method

```typescript
search(query: string, opts?: { limit?: number; full?: boolean }): Promise<{
  query: string;
  mode: 'hybrid' | 'keyword';
  hits: KnowledgeHit[];
}>
```

- `limit` — how many passages, 1–30 (default 10).
- `full` — `true` returns each whole passage instead of a ~700-character snippet.

Each hit carries `text`, `locator` (the section it came from), `score`, `cite`
(ready-to-show citation), `url`, and `source: { kind, id, title, url }` — `kind` is
`page` or `asset` (a File). `mode` is `hybrid` (meaning + keywords) where the instance
has embeddings, otherwise `keyword`.

## Example

```javascript
const sdk = await ShareOut.create();

const { hits } = await sdk.knowledge.search('inspection periodicity', { limit: 5 });
list.innerHTML = '';
for (const h of hits) {
  const li = document.createElement('li');
  li.textContent = `${h.text} — ${h.cite}`;
  list.appendChild(li);
}
```

Show `cite` (and link `source.url` when it has one) next to each passage, so readers
can find the original.

## Who sees what

Hits are filtered for the person viewing the page: another member's private page or
File never appears, exactly as in the workspace's own search. Every call is counted in
the workspace's Knowledge usage.

## Errors

The call throws a [`ShareOutError`](/sdk/overview/#errors):

| `status` | `code` | When |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | The viewer isn't signed in |
| 403 | `FORBIDDEN` | The viewer isn't an internal member of the workspace, or the artifact has no workspace |
| 404 | `NOT_FOUND` | Knowledge isn't turned on for the workspace |
| 400 | `INVALID_REQUEST` | Empty query |

REST equivalent: `GET /v1/data/{artifactId}/knowledge/search?q=&limit=&full=1`.
For service tokens and agents, use the workspace route in
[Knowledge → REST API](/teams/knowledge/#rest-api).
